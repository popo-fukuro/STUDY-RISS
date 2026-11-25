// 地図ページをブラウザで開いて、スクリーンショットと自動チェックを行う（手元での確認用）。
//   node map/tools/screenshot.mjs <出力フォルダ>
// 前提：python map/tools/build.py を実行済み。Playwright（chromium）が使えること。
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const page_url = "file://" + resolve(here, "../../docs/map/index.html");
const outDir = resolve(process.argv[2] || "map-shots");
mkdirSync(outDir, { recursive: true });

const report = { console: [], checks: [], shots: [] };
const fail = (name, detail) => report.checks.push({ ok: false, name, detail });
const pass = (name, detail) => report.checks.push({ ok: true, name, detail });

function overlap(a, b, m = 0) {
  return a.x < b.x + b.width - m && b.x < a.x + a.width - m && a.y < b.y + b.height - m && b.y < a.y + a.height - m;
}

async function run(viewport, scheme, label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1, hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") report.console.push(`[${label}] ${m.text()}`); });
  page.on("pageerror", (e) => report.console.push(`[${label}] pageerror ${e.message}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!/fonts\.(googleapis|gstatic)\.com/.test(u)) report.console.push(`[${label}] requestfailed ${u}`);
  });
  await page.goto(page_url + "#map");
  await page.waitForTimeout(800);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.evaluate(() => window.__rissMap.fit());
  await page.waitForTimeout(300);
  const shot = async (name) => {
    const file = `${outDir}/${label}-${name}.png`;
    await page.screenshot({ path: file });
    report.shots.push(file);
  };

  // --- 地図（全体表示） ---
  await shot("map-fit");
  const geo = await page.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const cards = [...document.querySelectorAll(".card")].map((c) => ({ id: c.dataset.id, ...r(c.querySelector(".card-compact-bg")) }));
    const legend = r(document.querySelector("#legend"));
    const note = r(document.querySelector("#a1-note"));
    const zoom = r(document.querySelector(".zoom-ctl"));
    const wrap = r(document.querySelector("#map-wrap"));
    const labels = [...document.querySelectorAll(".domain-label")].map((t) => ({ text: t.textContent, ...r(t) }));
    const k = window.__rissMap.view.k;
    return { cards, legend, note, zoom, wrap, labels, k };
  });
  const cardPairs = [];
  for (let i = 0; i < geo.cards.length; i++) for (let j = i + 1; j < geo.cards.length; j++) {
    if (overlap(geo.cards[i], geo.cards[j])) cardPairs.push(`${geo.cards[i].id}/${geo.cards[j].id}`);
  }
  cardPairs.length ? fail(`${label} カードの重なり`, cardPairs) : pass(`${label} カードの重なり`, "なし");
  const legendHits = geo.cards.filter((c) => overlap(c, geo.legend, 2)).map((c) => c.id);
  const noteHits = geo.cards.filter((c) => overlap(c, geo.note, 2)).map((c) => c.id);
  const zoomHits = geo.cards.filter((c) => overlap(c, geo.zoom, 2)).map((c) => c.id);
  const labelHits = geo.labels.filter((l) => overlap(l, geo.legend, 2) || overlap(l, geo.note, 2)).map((l) => l.text);
  const res = (name, arr) => (arr.length ? fail(name, arr) : pass(name, "なし"));
  res(`${label} 凡例パネルとカード`, legendHits);
  res(`${label} 右下の注記とカード`, noteHits);
  res(`${label} 拡大ボタンとカード`, zoomHits);
  res(`${label} 凡例・注記と領域名`, labelHits);
  const outside = geo.labels.filter((l) => l.x < geo.wrap.x - 1 || l.y < geo.wrap.y - 1 || l.x + l.width > geo.wrap.x + geo.wrap.width + 1 || l.y + l.height > geo.wrap.y + geo.wrap.height + 1).map((l) => l.text);
  res(`${label} 領域名の欠け`, outside);
  pass(`${label} 全体表示の拡大率`, geo.k.toFixed(3));

  // --- カード内の文字のはみ出し（簡略表示・詳細表示の両方） ---
  const overflow = async (mode) => page.evaluate((mode) => {
    const svg = document.querySelector("#map");
    svg.classList.toggle("lod-detail", mode === "detail");
    const bad = [];
    document.querySelectorAll(".card").forEach((c) => {
      const box = c.querySelector(mode === "detail" ? ".card-bg" : ".card-compact-bg").getBBox();
      const sel = mode === "detail" ? ".lod-detail-only text" : ".lod-compact-only text";
      c.querySelectorAll(sel).forEach((t) => {
        const b = t.getBBox();
        if (b.x < box.x + 4 || b.x + b.width > box.x + box.width - 4 || b.y < box.y || b.y + b.height > box.y + box.height) {
          bad.push(`${c.dataset.id}:「${t.textContent}」(${Math.round(b.x)}..${Math.round(b.x + b.width)})`);
        }
      });
    });
    return bad;
  }, mode);
  res(`${label} 文字のはみ出し（簡略表示）`, await overflow("compact"));
  res(`${label} 文字のはみ出し（詳細表示）`, await overflow("detail"));
  await page.evaluate(() => window.__rissMap.fit());

  // --- 関係ラベルの重なり（すべて表示したとき） ---
  const relLabelOverlap = await page.evaluate(() => {
    document.querySelector("#opt-labels").click();
    const boxes = [...document.querySelectorAll(".rel-label-holder")].filter((h) => h.style.display !== "none")
      .map((h) => { const b = h.getBoundingClientRect(); return { id: h.dataset.for, x: b.x, y: b.y, width: b.width, height: b.height }; });
    const hits = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) hits.push(`${a.id}×${b.id}`);
    }
    return { n: boxes.length, hits };
  });
  await shot("map-labels");
  relLabelOverlap.hits.length ? fail(`${label} 関係ラベルどうしの重なり（全表示）`, relLabelOverlap.hits) : pass(`${label} 関係ラベルどうしの重なり（全表示）`, `${relLabelOverlap.n}個とも重ならない`);
  await page.evaluate(() => document.querySelector("#opt-labels").click());

  // --- ホバー（デスクトップ）とカードを開いた状態 ---
  if (viewport.width >= 600) {
    const card = page.locator('.card[data-id="crypto"]');
    await card.hover();
    await page.waitForTimeout(250);
    await shot("map-hover");
  }
  await page.evaluate(() => window.__rissMap.openField("crypto"));
  await page.waitForTimeout(400);
  await shot("map-card-open");
  // Esc で閉じる
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.querySelector("#panel").classList.contains("open"));
  closed ? pass(`${label} Escでパネルを閉じる`, "閉じた") : fail(`${label} Escでパネルを閉じる`, "閉じない");

  // キーボード：Tab でカードに移り Enter で開く
  await page.evaluate(() => document.querySelector('.card[data-id="basics"]').focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const kb = await page.evaluate(() => document.querySelector("#panel").classList.contains("open") && document.querySelector("#panel-title").textContent);
  kb ? pass(`${label} キーボードでカードを開く`, kb) : fail(`${label} キーボードでカードを開く`, "開かない");
  await page.keyboard.press("Escape");

  // 関係の矢印を開く
  await page.evaluate(() => window.__rissMap.openRelation("r-ops-incident"));
  await page.waitForTimeout(300);
  await shot("map-relation-open");
  await page.keyboard.press("Escape");

  // 拡大（中分類の表示）
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => document.querySelector("#map").classList.contains("lod-detail"))) break;
    await page.click("#zoom-in");
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(250);
  const lod = await page.evaluate(() => document.querySelector("#map").classList.contains("lod-detail"));
  lod ? pass(`${label} 拡大で中分類に切り替わる`, "切り替わった") : fail(`${label} 拡大で中分類に切り替わる`, "切り替わらない");
  await shot("map-zoomed");
  await page.click("#zoom-fit");

  // 検索
  await page.fill("#q", "DMARC");
  await page.waitForTimeout(250);
  await shot("search");
  const hits = await page.evaluate(() => [...document.querySelectorAll(".card.hit")].map((c) => c.dataset.id));
  hits.length ? pass(`${label} 検索で分野を縁取る`, hits) : fail(`${label} 検索で分野を縁取る`, "なし");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const flashed = await page.evaluate(() => { const f = document.querySelector(".t-term.flash"); return f ? f.textContent.slice(0, 20) : null; });
  flashed ? pass(`${label} 候補を選ぶと詳細の用語へ移動し強調`, flashed) : fail(`${label} 候補を選ぶと詳細の用語へ移動し強調`, "強調なし");
  await shot("search-jump");
  await page.fill("#q", "");

  // 各タブ
  for (const tab of ["detail", "links", "exam"]) {
    await page.goto(page_url + "#" + tab);
    await page.waitForTimeout(500);
    await shot(tab);
    const horiz = await page.evaluate((tab) => {
      const v = document.querySelector(`#view-${tab}`);
      return v.scrollWidth > v.clientWidth + 1 ? `${v.scrollWidth} > ${v.clientWidth}` : null;
    }, tab);
    horiz ? fail(`${label} ${tab} の横はみ出し`, horiz) : pass(`${label} ${tab} の横はみ出し`, "なし");
  }
  // 関係カードを選ぶ
  await page.goto(page_url + "#links");
  await page.waitForTimeout(400);
  await page.click('[data-rel-card="r-netdef-risk"]');
  await page.waitForTimeout(300);
  const miniOn = await page.evaluate(() => [...document.querySelectorAll("#mini .on")].map((x) => x.dataset.id));
  miniOn.length === 3 ? pass(`${label} 関係カードで縮小図を強調`, miniOn) : fail(`${label} 関係カードで縮小図を強調`, miniOn);
  await page.evaluate(() => document.querySelector(".mini-wrap").scrollIntoView());
  await shot("links-selected");
  await page.goto(page_url + "#detail");
  await page.waitForTimeout(300);
  await page.click('[data-filter="high"]');
  await page.waitForTimeout(200);
  const nHigh = await page.evaluate(() => [...document.querySelectorAll(".fsec")].filter((s) => !s.hidden).length);
  pass(`${label} 優先度「高」の絞り込み`, `${nHigh}分野`);
  await shot("detail-filter-high");
  await browser.close();
}

const cases = [
  [{ width: 1400, height: 900 }, "light", "desktop-light"],
  [{ width: 1400, height: 900 }, "dark", "desktop-dark"],
  [{ width: 390, height: 800 }, "light", "mobile-light"],
  [{ width: 390, height: 800 }, "dark", "mobile-dark"],
];
for (const c of cases) await run(...c);
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
const bad = report.checks.filter((c) => !c.ok);
for (const c of report.checks) console.log(`${c.ok ? "OK " : "NG "} ${c.name}: ${JSON.stringify(c.detail)}`);
console.log(`コンソールエラー: ${report.console.length}件`);
report.console.forEach((m) => console.log("  ", m));
console.log(`スクリーンショット ${report.shots.length}枚 → ${outDir}`);
process.exit(bad.length || report.console.length ? 1 : 0);
