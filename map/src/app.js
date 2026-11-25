/* RISS 試験範囲マップ（素の JavaScript）。データは <script id="map-data"> の JSON。 */
(function () {
  "use strict";

  const DATA = JSON.parse(document.getElementById("map-data").textContent);
  const META = DATA.meta;
  const L = META.layout;
  const FIELDS = DATA.fields;
  const RELS = DATA.relations;
  const N = FIELDS.length;
  const C = L.size / 2;
  const SVGNS = "http://www.w3.org/2000/svg";
  const PRI = { high: "高", mid: "中", low: "低" };
  const byId = Object.fromEntries(FIELDS.map((f) => [f.id, f]));
  const domainById = Object.fromEntries(DATA.domains.map((d) => [d.id, d]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- 小さな道具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const zen = (s) => Array.from(s).reduce((n, ch) => n + (/[\x20-\x7e｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);
  const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  const rad = (deg) => (deg * Math.PI) / 180;
  const fcolor = (id) => `var(--f-${id})`;
  const dcolor = (id) => `var(--d-${id})`;
  const termCount = (f) => f.subs.reduce((n, s) => n + s.terms.length, 0);
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動く */ } },
  };
  function pillHTML(p) { return `<span class="pill ${p}">優先度 ${PRI[p]}</span>`; }
  function badgeHTML(f) {
    return (f.badges || []).map((b) => `<span class="badge weight" title="${esc(META.badges[b].desc)}">${esc(META.badges[b].label)}</span>`).join("");
  }
  function termBadges(t) {
    if (t.sup) return ` <span class="badge sup" title="${esc(META.badges.sup.desc)}">補</span>`;
    if (t.new) return ` <span class="badge new" title="${esc(META.badges.new.desc)}">新案</span>`;
    return "";
  }
  function chipHTML(fid) {
    const f = byId[fid];
    return `<a class="chip" href="#detail" data-goto-field="${f.id}"><span class="swatch" style="--c:${fcolor(f.id)}"></span>${esc(f.short)}</a>`;
  }
  function noteLink(t) {
    if (!t.note) return "";
    const href = META.siteUrl + t.note.replace(/\.md$/, "/");
    return ` <a class="note-link" href="${esc(href)}" target="_blank" rel="noopener">ノートを読む↗</a>`;
  }
  function textbookHTML(f) {
    if (!f.textbook || !f.textbook.length) return "";
    const chapters = [...new Set(f.textbook.map((x) => x.split(".")[0]))];
    const links = chapters.map((ch) => {
      const n = String(ch).padStart(2, "0");
      const secs = f.textbook.filter((x) => x.split(".")[0] === ch).join("・");
      return `<a href="${esc(META.siteUrl)}ch${n}/" target="_blank" rel="noopener">第${ch}章（${esc(secs)}）</a>`;
    });
    return links.join("、");
  }

  // ---------- 配置の計算（tools/check.py と同じ式） ----------
  function cardHeight(f) { return L.cardHeader + L.cardPad + L.cardRow * f.subs.length + L.cardFooter; }
  const POS = FIELDS.map((f, i) => {
    const ang = L.startAngle + (360 * i) / N;
    const cx = C + L.radius * Math.cos(rad(ang));
    const cy = C + L.radius * Math.sin(rad(ang));
    const w = L.cardWidth, h = cardHeight(f);
    return { id: f.id, i, ang, cx, cy, w, h, x: cx - w / 2, y: cy - h / 2 };
  });
  const posById = Object.fromEntries(POS.map((p) => [p.id, p]));

  // カードの中心から地図の中心へ向かう線と、カードの縁との交点（少し内側へ離す）
  function anchor(p, gap = 16, tangent = 0) {
    const dx = C - p.cx, dy = C - p.cy;
    const tx = dx !== 0 ? (p.w / 2) / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? (p.h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    return { x: p.cx + dx * t + ux * gap - uy * tangent, y: p.cy + dy * t + uy * gap + ux * tangent };
  }

  // 関係の曲線：中心寄りに膨らむ二次ベジェ。離れた分野ほど中心に近い所を通る（中心の円は避ける）
  const MID_R = [0, 700, 660, 600, 530, 450, 385, 330, 300];
  function relGeometry(r, scale = 1, center = C, getPos = (id) => posById[id], anchorFn = anchor) {
    const a = getPos(r.from), b = getPos(r.to);
    let s = (b.i - a.i + N) % N;           // 時計回りのステップ数
    const cw = s <= N / 2;
    const steps = cw ? s : N - s;
    const sign = cw ? 1 : -1;
    const off = (18 + 7 * steps) * scale;
    const p0 = anchorFn(a, 16 * scale, sign * off);
    const p2 = anchorFn(b, 16 * scale, -sign * off);
    const phi = rad(a.ang + sign * (steps * 360 / N) / 2);
    const ux = Math.cos(phi), uy = Math.sin(phi);
    const sx = (p0.x - center) + (p2.x - center), sy = (p0.y - center) + (p2.y - center);
    const proj = sx * ux + sy * uy;
    const m = MID_R[Math.min(steps, MID_R.length - 1)] * scale;
    const rc = 2 * (m - 0.25 * proj);
    const c = { x: center + rc * ux, y: center + rc * uy };
    const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p2.y };
    return { p0, p2, c, mid };
  }
  function arrowHead(tip, from, size) {
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const bx = tip.x - ux * size, by = tip.y - uy * size;
    const w = size * 0.55;
    return `${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${(bx - uy * w).toFixed(1)},${(by + ux * w).toFixed(1)} ${(bx + uy * w).toFixed(1)},${(by - ux * w).toFixed(1)}`;
  }
  function arcPath(r, a0, a1, reverse) {
    const p = (a) => [C + r * Math.cos(rad(a)), C + r * Math.sin(rad(a))];
    const [x0, y0] = p(reverse ? a1 : a0), [x1, y1] = p(reverse ? a0 : a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} ${reverse ? 0 : 1} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  function splitShort(f) {
    if (f.shortLines && f.shortLines.length) return f.shortLines;
    if (zen(f.short) <= 6) return [f.short];
    const i = Math.ceil(f.short.length / 2);
    return [f.short.slice(0, i), f.short.slice(i)];
  }

  // ---------- 地図を描く ----------
  const svg = $("#map");
  const wrap = $("#map-wrap");
  const vp = el("g", { id: "viewport" }, svg);
  const gBack = el("g", { class: "layer-back" }, vp);
  const gTrunk = el("g", { class: "layer-trunk" }, vp);
  const gRel = el("g", { class: "layer-rel" }, vp);
  const gCenter = el("g", { class: "layer-center" }, vp);
  const gCard = el("g", { class: "layer-card" }, vp);
  const gLabel = el("g", { class: "layer-label" }, vp);
  const step = 360 / N;

  function drawBackground() {
    // 領域ごとの扇形
    const groups = [];
    FIELDS.forEach((f, i) => {
      const g = groups[groups.length - 1];
      if (g && g.domain === f.domain) g.last = i; else groups.push({ domain: f.domain, first: i, last: i });
    });
    const R = L.ringLabel - 50;
    groups.forEach((g) => {
      const a0 = L.startAngle + g.first * step - step / 2;
      const a1 = L.startAngle + g.last * step + step / 2;
      const p = (r, a) => `${(C + r * Math.cos(rad(a))).toFixed(1)},${(C + r * Math.sin(rad(a))).toFixed(1)}`;
      const r0 = L.centerRadius + 20;
      const d = `M${p(r0, a0)} L${p(R, a0)} A${R},${R} 0 0 1 ${p(R, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`;
      el("path", { d, class: "sector", style: `--c:${dcolor(g.domain)}` }, gBack);
      el("path", { d: arcPath(R, a0 + 0.6, a1 - 0.6), class: "sector-edge", style: `--c:${dcolor(g.domain)}` }, gBack);
      // 円弧に沿った領域名（下半分は文字が逆さにならないよう逆向きに）
      const mid = ((a0 + a1) / 2 + 360) % 360;
      const lower = mid > 0 && mid < 180;
      const pid = `arc-${g.domain}`;
      el("path", { id: pid, d: arcPath(lower ? L.ringLabel + 34 : L.ringLabel, a0, a1, lower), fill: "none" }, gBack);
      const t = el("text", { class: "domain-label", style: `--c:${dcolor(g.domain)}` }, gBack);
      const tp = el("textPath", { href: `#${pid}`, startOffset: "50%", "text-anchor": "middle" }, t);
      tp.textContent = domainById[g.domain].name;
    });
    // 測量図風の同心円と目盛り
    [320, 560, 800, L.ringLabel - 50].forEach((r, i) => el("circle", { cx: C, cy: C, r, class: i % 2 ? "ring" : "ring dash" }, gBack));
    el("circle", { cx: C, cy: C, r: L.ringTick, class: "ring" }, gBack);
    for (let a = 0; a < 360; a += 2.5) {
      const major = a % 22.5 === 0;
      const r0 = L.ringTick, r1 = L.ringTick + (major ? 34 : 14);
      el("line", {
        x1: C + r0 * Math.cos(rad(a)), y1: C + r0 * Math.sin(rad(a)),
        x2: C + r1 * Math.cos(rad(a)), y2: C + r1 * Math.sin(rad(a)), class: major ? "tick major" : "tick",
      }, gBack);
    }
    for (let a = 0; a < 360; a += 45) {
      const bearing = (a + 90) % 360;  // 真上を000とする方位
      const r = L.ringTick - 30;
      el("text", {
        x: C + r * Math.cos(rad(a)), y: C + r * Math.sin(rad(a)) + 8, class: "tick-label", "text-anchor": "middle",
      }, gBack).textContent = String(bearing).padStart(3, "0");
    }
  }

  function drawCenter() {
    el("circle", { cx: C, cy: C, r: L.centerRadius + 26, class: "center-ring2" }, gCenter);
    el("circle", { cx: C, cy: C, r: L.centerRadius, class: "center-disc" }, gCenter);
    ["情報処理", "安全確保", "支援士"].forEach((s, i) => {
      el("text", { x: C, y: C - 46 + i * 60, class: "center-title" }, gCenter).textContent = s;
    });
    el("text", { x: C, y: C + 128, class: "center-sub" }, gCenter).textContent = "RISS · SC";
  }

  function drawTrunks() {
    POS.forEach((p) => {
      const a = anchor(p, 10);
      const ang = rad(p.ang);
      const s = { x: C + (L.centerRadius + 8) * Math.cos(ang), y: C + (L.centerRadius + 8) * Math.sin(ang) };
      const rm = (L.centerRadius + Math.hypot(a.x - C, a.y - C)) / 2;
      const ca = rad(p.ang + 7);
      const c = { x: C + rm * Math.cos(ca), y: C + rm * Math.sin(ca) };
      el("path", {
        d: `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${a.x.toFixed(1)},${a.y.toFixed(1)}`,
        class: "trunk", "data-id": p.id, style: `--c:${fcolor(p.id)}`,
      }, gTrunk);
    });
  }

  function drawRelations() {
    RELS.forEach((r) => {
      const g = el("g", {
        class: `rel${r.core ? " core" : ""}`, "data-id": r.id, "data-from": r.from, "data-to": r.to,
        tabindex: "0", role: "button",
        "aria-label": `${byId[r.from].short}${r.dir === "both" ? "と" : "から"}${byId[r.to].short}${r.dir === "both" ? "の相互" : "へ"}の関係：${r.label}。Enterで説明を開く`,
      }, gRel);
      const { p0, p2, c, mid } = relGeometry(r);
      const d = `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
      el("path", { d, class: "rel-hit" }, g);
      el("path", { d, class: "rel-line" }, g);
      const size = r.core ? 34 : 26;
      el("polygon", { points: arrowHead(p2, c, size), class: "rel-head" }, g);
      if (r.dir === "both") el("polygon", { points: arrowHead(p0, c, size), class: "rel-head" }, g);
      const w = Math.max(120, zen(r.label) * 24 + 28);
      const lg = el("g", { class: "rel-label", "data-x": mid.x, "data-y": mid.y, "data-w": w }, g);
      el("rect", { x: -w / 2, y: -21, width: w, height: 40, rx: 20 }, lg);
      el("text", { x: 0, y: 8 }, lg).textContent = r.label;
    });
  }

  function drawCards() {
    FIELDS.forEach((f) => {
      const p = posById[f.id];
      const g = el("g", {
        class: "card", transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`, "data-id": f.id,
        tabindex: "0", role: "button", style: `--c:${fcolor(f.id)}`,
        "aria-label": `${f.name}（${domainById[f.domain].name}、優先度${PRI[f.priority]}）。中分類${f.subs.length}、小分類${termCount(f)}語。Enterで詳細を開く`,
      }, gCard);
      const W = p.w, H = p.h;
      // 縮小時：分野色で塗った簡略表示
      const cg = el("g", { class: "lod-compact-only" }, g);
      el("rect", { width: W, height: H, rx: 18, class: "card-compact-bg" }, cg);
      const lines = splitShort(f);
      const maxLen = Math.max(...lines.map(zen));
      const fs = Math.min(58, Math.floor(262 / maxLen));
      const blockH = lines.length * fs * 1.18;
      const top = (H - 64) / 2 - blockH / 2 + fs * 0.92;
      lines.forEach((ln, i) => {
        el("text", { x: W / 2, y: top + i * fs * 1.18, class: "card-big", "font-size": fs }, cg).textContent = ln;
      });
      const pw = 132, ph = 40;
      el("rect", { x: W / 2 - pw / 2, y: H - 58, width: pw, height: ph, rx: 20, class: `pill-bg ${f.priority}`, stroke: "#FFFFFF", "stroke-width": 3 }, cg);
      el("text", { x: W / 2, y: H - 31, class: `pill-text ${f.priority}`, "font-size": 21 }, cg).textContent = `優先度 ${PRI[f.priority]}`;
      // 拡大時：中分類の一覧
      const dg = el("g", { class: "lod-detail-only" }, g);
      el("rect", { width: W, height: H, rx: 14, class: "card-bg" }, dg);
      el("rect", { width: W, height: L.cardHeader, rx: 14, class: "card-band" }, dg);
      el("rect", { y: L.cardHeader - 16, width: W, height: 16, class: "card-band-sq" }, dg);
      el("text", { x: W / 2, y: 40, class: "card-short" }, dg).textContent = f.short;
      f.subs.forEach((s, i) => {
        const y = L.cardHeader + L.cardPad / 2 + i * L.cardRow;
        el("rect", { x: 18, y: y + 9, width: 14, height: 14, rx: 2, class: "sub-sq" }, dg);
        el("text", { x: 42, y: y + 23, class: "sub-name" }, dg).textContent = s.name;
      });
      const fy = H - L.cardFooter;
      el("line", { x1: 14, y1: fy, x2: W - 14, y2: fy, class: "card-foot-sep" }, dg);
      el("rect", { x: 14, y: fy + 11, width: 96, height: 30, rx: 15, class: `pill-bg ${f.priority}` }, dg);
      el("text", { x: 62, y: fy + 32, class: `pill-text ${f.priority}` }, dg).textContent = `優先度 ${PRI[f.priority]}`;
      el("text", { x: W - 16, y: fy + 32, class: "card-open" }, dg).textContent = `小分類 ${termCount(f)}語を開く ›`;
      if ((f.badges || []).includes("new-weight")) {
        el("rect", { x: W - 136, y: -16, width: 128, height: 28, rx: 8, class: "card-weight-bg" }, g);
        el("text", { x: W - 72, y: 4, class: "card-weight", "text-anchor": "middle" }, g).textContent = "新制度で重み増";
      }
      el("rect", { x: -7, y: -7, width: W + 14, height: H + 14, rx: 20, class: "card-ring" }, g);
    });
  }

  // 簡略表示の大きな文字：フォントの実際の幅を測ってカードに収める
  function fitCompactText() {
    $$(".card-big", gCard).forEach((t) => {
      if (!t.dataset.fs0) t.dataset.fs0 = t.getAttribute("font-size");
      t.setAttribute("font-size", t.dataset.fs0);
    });
    $$(".card", gCard).forEach((c) => {
      const texts = $$(".card-big", c);
      const w = Math.max(...texts.map((t) => t.getComputedTextLength() || 0));
      if (w > 266) texts.forEach((t) => t.setAttribute("font-size", (Number(t.dataset.fs0) * 266 / w).toFixed(1)));
    });
  }

  drawBackground();
  drawTrunks();
  drawRelations();
  drawCenter();
  drawCards();
  // ラベルは最前面に移す（カードの下に隠れないように）
  $$(".rel", gRel).forEach((g) => {
    const lg = $(".rel-label", g);
    const holder = el("g", { class: "rel-label-holder", "data-for": g.dataset.id }, gLabel);
    holder.appendChild(lg);
  });

  // ---------- 拡大・移動 ----------
  const view = { k: 0.3, x: 0, y: 0, auto: true };
  let fitK = 0.3;
  function applyView() {
    vp.setAttribute("transform", `translate(${view.x.toFixed(2)},${view.y.toFixed(2)}) scale(${view.k.toFixed(5)})`);
    svg.classList.toggle("lod-detail", view.k >= L.lodThreshold);
    layoutLabels();
  }
  // 表示中の関係ラベルを、重ならないように上下へずらして置く
  // ラベルを置かない場所：カードと中心の円（座標空間での矩形）
  const OBSTACLES = POS.map((p) => ({ x: p.cx, y: p.cy, w: p.w + 24, h: p.h + 24 }))
    .concat([{ x: C, y: C, w: (L.centerRadius + 30) * 2, h: (L.centerRadius + 30) * 2 }]);
  function layoutLabels() {
    const s = Math.max(1, 0.52 / view.k);
    const placed = OBSTACLES.slice();
    const holders = $$(".rel-label-holder", gLabel);
    const vis = holders.filter((h) => h.style.display !== "none");
    const isOn = (h) => (gRel.querySelector(`[data-id="${h.dataset.for}"]`) || h).classList.contains("on");
    // 強調中の関係のラベルを先に置く。同じ組の中は上から順に
    vis.sort((a, b) => (isOn(b) - isOn(a)) || (Number($(".rel-label", a).dataset.y) - Number($(".rel-label", b).dataset.y)));
    holders.forEach((h) => {
      const lg = $(".rel-label", h);
      lg.setAttribute("transform", `translate(${lg.dataset.x},${lg.dataset.y}) scale(${s.toFixed(3)})`);
    });
    vis.forEach((h) => {
      const lg = $(".rel-label", h);
      const y0 = Number(lg.dataset.y);
      const w = (Number(lg.dataset.w) + 8) * s, hh = 44 * s;
      const x0 = Number(lg.dataset.x);
      const len = Math.hypot(C - x0, C - y0) || 1;
      const ix = (C - x0) / len, iy = (C - y0) / len;   // 中心へ向かう向き
      let x = x0, y = y0, best = null;
      search:
      for (let r = 0; r < 16; r++) {
        for (const v of [0, -1, 1, -2, 2]) {
          for (const hs of [0, -0.5, 0.5]) {
            x = x0 + ix * r * hh * 0.6 + hs * w;
            y = y0 + iy * r * hh * 0.6 + v * hh * 0.9;
            if (Math.hypot(x - C, y - C) > L.radius + 120) continue;
            const hit = placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + hh) / 2);
            if (!hit) { best = { x, y }; break search; }
          }
        }
      }
      // どこにも置けないとき：強調中なら元の位置に重ねて出し、常時表示のラベルは省略する
      if (!best) {
        if (!isOn(h)) { h.style.display = "none"; return; }
        best = { x: x0, y: y0 };
      }
      x = best.x; y = best.y;
      placed.push({ x, y, w, h: hh });
      lg.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(3)})`);
    });
  }
  function fit() {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ext = (L.ringTick + 46) * 2;
    fitK = Math.min((r.width - 16) / ext, (r.height - 16) / ext);
    view.k = fitK;
    view.x = r.width / 2 - C * fitK;
    view.y = r.height / 2 - C * fitK;
    // 左上の凡例パネルが開いているときは、重ならない範囲で地図を右へ寄せる
    const lgd = $("#legend");
    if (r.width > 860 && lgd.open) {
      const lr = lgd.getBoundingClientRect(), zr = $(".zoom-ctl").getBoundingClientRect();
      const half = (ext / 2) * fitK;
      const left = r.width / 2 - half;
      const want = lr.right - r.left + 10 - left;
      const room = (zr.left - r.left - 10) - (r.width / 2 + half);
      let shift = Math.max(0, Math.min(want, room));
      // 右下の注記に地図の外周がかからないよう、寄せる量を減らす
      const nr = $("#a1-note").getBoundingClientRect();
      const cy = r.height / 2;
      const clear = (sh) => {
        const cx = r.width / 2 + sh;
        const nx = Math.min(Math.max(cx, nr.left - r.left), nr.right - r.left);
        const ny = Math.min(Math.max(cy, nr.top - r.top), nr.bottom - r.top);
        return Math.hypot(nx - cx, ny - cy) > half - 30;
      };
      while (shift > 0 && !clear(shift)) shift -= 2;
      view.x += Math.max(0, shift);
    }
    view.auto = true;
    applyView();
  }
  function zoomAt(px, py, factor) {
    const k2 = Math.min(Math.max(view.k * factor, fitK * 0.6), 3);
    const f = k2 / view.k;
    view.x = px - (px - view.x) * f;
    view.y = py - (py - view.y) * f;
    view.k = k2;
    view.auto = false;
    applyView();
  }
  function zoomCenter(factor) {
    const r = wrap.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  }
  $("#zoom-in").addEventListener("click", () => zoomCenter(1.45));
  $("#zoom-out").addEventListener("click", () => zoomCenter(1 / 1.45));
  $("#zoom-fit").addEventListener("click", fit);

  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
    zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
  }, { passive: false });

  const pointers = new Map();
  let drag = null;
  let suppressClick = false;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, id: e.pointerId };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: true };
    }
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = wrap.getBoundingClientRect();
    if (drag.pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      view.x += mx - drag.mx;
      view.y += my - drag.my;
      zoomAt(mx - r.left, my - r.top, dist / (drag.dist || dist));
      drag.dist = dist; drag.mx = mx; drag.my = my;
      return;
    }
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      wrap.classList.add("dragging");
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
    }
    if (drag.moved) {
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      view.auto = false;
      applyView();
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (drag && drag.moved) suppressClick = true;
    if (pointers.size === 0) { drag = null; wrap.classList.remove("dragging"); }
    else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      drag = { sx: p.x, sy: p.y, vx: view.x, vy: view.y, moved: true };
    }
  }
  wrap.addEventListener("pointerup", endPointer);
  wrap.addEventListener("pointercancel", endPointer);
  wrap.addEventListener("click", (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  // ---------- 強調表示 ----------
  const state = { selected: null, selectedRel: null, hover: null, hoverRel: null, hits: new Set() };
  function relatedOf(fid) {
    const rels = RELS.filter((r) => r.from === fid || r.to === fid);
    return { rels: new Set(rels.map((r) => r.id)), fields: new Set(rels.flatMap((r) => [r.from, r.to])) };
  }
  function refreshFocus() {
    const fid = state.hover || (state.hoverRel ? null : state.selected);
    const rid = state.hoverRel || (state.hover ? null : state.selectedRel);
    let onRels = new Set(), onFields = new Set(), focusId = null;
    if (fid) {
      const r = relatedOf(fid);
      onRels = r.rels; onFields = r.fields; onFields.add(fid); focusId = fid;
    } else if (rid) {
      const r = RELS.find((x) => x.id === rid);
      onRels = new Set([rid]); onFields = new Set([r.from, r.to]);
    }
    const active = !!(fid || rid);
    svg.classList.toggle("focusing", active);
    $$(".card", gCard).forEach((c) => {
      const id = c.dataset.id;
      c.classList.toggle("is-focus", id === focusId);
      c.classList.toggle("is-dim", active && !onFields.has(id));
      c.classList.toggle("hit", state.hits.has(id));
    });
    $$(".trunk", gTrunk).forEach((t) => {
      t.classList.toggle("is-dim", active && !onFields.has(t.dataset.id));
      t.classList.toggle("is-on", active && onFields.has(t.dataset.id));
    });
    $$(".rel", gRel).forEach((g) => {
      const on = onRels.has(g.dataset.id);
      g.classList.toggle("on", on);
      g.classList.toggle("is-dim", active && !on);
    });
    $$(".rel-label-holder", gLabel).forEach((h) => {
      const g = gRel.querySelector(`[data-id="${h.dataset.for}"]`);
      const visible = svg.classList.contains("labels-on") || onRels.has(h.dataset.for);
      const hidden = g && getComputedStyle(g).display === "none";
      h.style.display = visible && !hidden ? "" : "none";
      $(".rel-label", h).style.display = "inline";
    });
    layoutLabels();
  }
  $$(".card", gCard).forEach((c) => {
    c.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { state.hover = c.dataset.id; refreshFocus(); } });
    c.addEventListener("pointerleave", () => { state.hover = null; refreshFocus(); });
    c.addEventListener("focus", () => { state.hover = c.dataset.id; refreshFocus(); });
    c.addEventListener("blur", () => { state.hover = null; refreshFocus(); });
    c.addEventListener("click", () => openField(c.dataset.id, c));
    c.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openField(c.dataset.id, c); }
    });
  });
  $$(".rel", gRel).forEach((g) => {
    g.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { state.hoverRel = g.dataset.id; refreshFocus(); } });
    g.addEventListener("pointerleave", () => { state.hoverRel = null; refreshFocus(); });
    g.addEventListener("focus", () => { state.hoverRel = g.dataset.id; refreshFocus(); });
    g.addEventListener("blur", () => { state.hoverRel = null; refreshFocus(); });
    g.addEventListener("click", () => openRelation(g.dataset.id, g));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRelation(g.dataset.id, g); }
    });
  });

  // ---------- 右側パネル ----------
  const panel = $("#panel");
  const panelBody = $("#panel-body");
  let lastFocus = null;
  function openPanel(html, opener) {
    panelBody.innerHTML = html;
    panelBody.scrollTop = 0;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    lastFocus = opener || document.activeElement;
    const title = $("#panel-title", panel);
    if (title) { title.setAttribute("tabindex", "-1"); title.focus({ preventScroll: true }); }
  }
  function closePanel() {
    if (!panel.classList.contains("open")) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    state.selected = null; state.selectedRel = null;
    refreshFocus();
    if (savedView) { Object.assign(view, savedView); savedView = null; applyView(); }
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  $("#panel-close").addEventListener("click", closePanel);

  function treeHTML(f, withIds) {
    const subs = f.subs.map((s) => {
      const terms = s.terms.map((t) => `<li><div class="t-term"${withIds ? ` id="t-${t.id}"` : ""}><span class="t-name">${esc(t.name)}</span>${termBadges(t)}<span class="t-desc">：${esc(t.desc)}</span>${noteLink(t)}</div></li>`).join("");
      return `<li><span class="t-sub"><span class="swatch" style="--c:${fcolor(f.id)}"></span>${esc(s.name)}</span><ul>${terms}</ul></li>`;
    }).join("");
    return `<ul class="tree"><li><span class="t-root"><span class="swatch" style="--c:${fcolor(f.id)}"></span>${esc(f.name)}</span><ul>${subs}</ul></li></ul>`;
  }
  function examInfoHTML(f) {
    const official = f.official.map((o) => `<li>${esc(o.doc)}：${esc(o.where)}</li>`).join("");
    return `<dl class="info">
      <dt>主なテーマ</dt><dd><ul>${f.themes.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></dd>
      <dt>重要キーワード</dt><dd>${f.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</dd>
      <dt>科目A-2での出方</dt><dd>${esc(f.examA2)}</dd>
      <dt>科目Bでの使われ方</dt><dd>${esc(f.examB)}</dd>
      <dt>公式文書での対応箇所</dt><dd><ul>${official}</ul></dd>
      <dt>優先度の根拠 ${pillHTML(f.priority)}</dt><dd>${esc(f.priorityReason)}</dd>
      ${f.textbook && f.textbook.length ? `<dt>参考書の章（このサイトのノート）</dt><dd>${textbookHTML(f)}</dd>` : ""}
    </dl>`;
  }
  function linkListHTML(f) {
    const rels = RELS.filter((r) => r.from === f.id || r.to === f.id);
    if (!rels.length) return "<p>つながりのデータはありません。</p>";
    return `<ul class="link-list">${rels.map((r) => {
      const other = r.from === f.id ? r.to : r.from;
      const arrow = r.dir === "both" ? "⇄" : (r.from === f.id ? "→" : "←");
      return `<li><button type="button" data-open-rel="${r.id}"><span class="lk-to">${arrow} ${esc(byId[other].short)}</span><span class="kind${r.core ? " core" : ""}">${r.core ? "重要な7関係" : "関係"}</span><span class="lk-label">${esc(r.label)}</span></button></li>`;
    }).join("")}</ul>`;
  }
  let savedView = null;
  function keepVisible(fid) {
    if ($("#view-map").hidden || window.innerWidth <= 860) return;
    const c = gCard.querySelector(`[data-id="${fid}"]`);
    if (!c) return;
    const cr = c.getBoundingClientRect();
    const limit = window.innerWidth - Math.min(460, window.innerWidth) - 24;
    if (cr.right > limit) {
      if (!savedView) savedView = { ...view };
      view.x -= cr.right - limit;
      applyView();
    }
  }
  function openField(fid, opener) {
    const f = byId[fid];
    state.selected = fid; state.selectedRel = null;
    refreshFocus();
    keepVisible(fid);
    const dom = domainById[f.domain];
    openPanel(`
      <p class="crumb">RISS › <b>${esc(dom.name)}</b> › <b>${esc(f.short)}</b></p>
      <h2 class="panel-title" id="panel-title"><span class="swatch" style="--c:${fcolor(f.id)}"></span><span>${esc(f.name)}</span></h2>
      <div class="pills">${pillHTML(f.priority)}${badgeHTML(f)}<span class="badge sup">補</span><small>＝補足の知識</small> <span class="badge new">新案</span><small>＝新制度の案だけ</small></div>
      <p>${esc(f.summary)}</p>
      <p><button type="button" class="btn" data-goto-field="${f.id}">分野別詳細で見る</button></p>
      <h3>樹形図（大分類 › 中分類 › 用語）</h3>
      ${treeHTML(f, false)}
      <h3>他分野とのつながり</h3>
      ${linkListHTML(f)}
      <h3>試験対策</h3>
      ${examInfoHTML(f)}
    `, opener);
  }
  function relationHTML(r, withTitleId) {
    const a = byId[r.from], b = byId[r.to];
    const arrow = r.dir === "both" ? "⇄" : "→";
    return `
      <p class="crumb">RISS › 分野間の関係 › <b>${r.core ? "重要な7関係" : "そのほかの関係"}</b></p>
      <h2 class="panel-title"${withTitleId ? ' id="panel-title"' : ""}><span>${esc(a.short)} ${arrow} ${esc(b.short)}</span></h2>
      <div class="pills"><span class="kind${r.core ? " core" : ""}">${r.core ? "重要な7関係（太い実線）" : "そのほかの関係（破線）"}</span><span class="kind">${r.dir === "both" ? "双方向" : "片方向"}</span></div>
      <p style="font-size:17px;font-weight:700;color:var(--link-on)">${esc(r.label)}</p>
      <dl class="info">
        <dt>なぜつながるか</dt><dd>${esc(r.why)}</dd>
        <dt>具体例</dt><dd>${esc(r.example)}</dd>
        <dt>試験での現れ方</dt><dd>${esc(r.exam)}</dd>
      </dl>`;
  }
  function openRelation(rid, opener) {
    const r = RELS.find((x) => x.id === rid);
    state.selectedRel = rid; state.selected = null;
    refreshFocus();
    openPanel(`${relationHTML(r, true)}
      <h3>両端の分野</h3>
      <p class="pills"><button type="button" class="btn ghost" data-open-field="${r.from}">${esc(byId[r.from].short)}を開く</button>
      <button type="button" class="btn ghost" data-open-field="${r.to}">${esc(byId[r.to].short)}を開く</button></p>`, opener);
  }

  // ---------- 左上のパネルと右下の注記 ----------
  function buildLegend() {
    const doms = DATA.domains.map((d) => `<li><span class="swatch" style="--c:${dcolor(d.id)}"></span>${esc(d.name)}</li>`).join("");
    $("#legend-body").innerHTML = `
      <h3>使い方</h3>
      <ol>
        <li>ドラッグで移動、ホイールやピンチで拡大・縮小</li>
        <li>拡大すると、カードに中分類の一覧が出る</li>
        <li>カードを選ぶ（Tab → Enter）と、右に樹形図と試験対策</li>
        <li>矢印を選ぶと、分野どうしの関係の説明</li>
        <li>右上の検索で用語を探せる</li>
      </ol>
      <h3>表示設定</h3>
      <label><input type="checkbox" id="opt-links" checked> 関係の矢印を表示</label>
      <label><input type="checkbox" id="opt-core"> 重要な7つの関係だけ</label>
      <label><input type="checkbox" id="opt-labels"> 矢印のラベルを常に表示</label>
      <p class="legend-note" style="margin-top:2px;padding-top:0;border:0">重なって置けないラベルは省略する。拡大すると増える。</p>
      <h3>凡例</h3>
      <ul class="legend-list cols">${doms}</ul>
      <ul class="legend-list" style="margin-top:6px">
        <li><span class="pill high">優先度 高</span><span class="pill mid">中</span><span class="pill low">低</span></li>
        <li><span class="badge weight">新制度で重み増</span>新制度の案で強化される分野</li>
        <li><span class="badge sup">補</span>公式文書にない補足の知識</li>
        <li><span class="badge new">新案</span>新制度のシラバス案だけにある用語</li>
        <li><span class="line-sample"></span>重要な7つの関係（太い実線）</li>
        <li><span class="line-sample dash"></span>そのほかの関係（破線）</li>
        <li><span aria-hidden="true">▶</span>矢じりの向き＝影響の向き（両端は双方向）</li>
      </ul>
      <p class="legend-note">作成日（調査日）：${esc(META.created)}<br>${esc(META.notice)}</p>`;
    const sync = () => {
      svg.classList.toggle("no-links", !$("#opt-links").checked);
      svg.classList.toggle("core-only", $("#opt-core").checked);
      svg.classList.toggle("labels-on", $("#opt-labels").checked);
      refreshFocus();
    };
    ["#opt-links", "#opt-core", "#opt-labels"].forEach((s) => $(s).addEventListener("change", sync));
    if (window.matchMedia("(max-width: 860px)").matches) $("#legend").open = false;
    $("#legend").addEventListener("toggle", () => { if (view.auto) fit(); });
  }
  function buildA1Note() {
    $("#a1-note").innerHTML = `<strong>${esc(META.a1Note.title)}</strong><p>${esc(META.a1Note.text)}</p><p class="a1-new">${esc(META.a1Note.newText)}</p>`;
  }

  // ---------- 分野別詳細 ----------
  let detailFilter = "all";
  function buildDetail() {
    const groups = DATA.domains.map((d) => {
      const items = FIELDS.filter((f) => f.domain === d.id).map((f) =>
        `<li data-pri="${f.priority}"><a href="#detail" data-goto-field="${f.id}"><span class="swatch" style="--c:${fcolor(f.id)}"></span>${esc(f.short)}<span class="pill ${f.priority}">${PRI[f.priority]}</span></a></li>`).join("");
      return `<div><div class="nav-domain"><span class="swatch" style="--c:${dcolor(d.id)}"></span>${esc(d.name)}</div><ul class="nav-list">${items}</ul></div>`;
    }).join("");
    const sections = FIELDS.map((f) => `
      <section class="fsec" id="f-${f.id}" data-pri="${f.priority}" style="--c:${fcolor(f.id)}" aria-labelledby="fh-${f.id}">
        <div class="fsec-head">
          <div><div class="dom">${esc(domainById[f.domain].name)} › ${esc(f.short)}</div><h2 id="fh-${f.id}">${esc(f.name)}</h2></div>
          <div class="pills">${pillHTML(f.priority)}${badgeHTML(f)}</div>
        </div>
        <div class="fsec-body">
          <p class="fsec-summary">${esc(f.summary)}</p>
          <div><h3>樹形図</h3>${treeHTML(f, true)}</div>
          <div><h3>試験対策</h3>${examInfoHTML(f)}</div>
          <div class="fsec-links"><h3>つながり</h3>${linkListHTML(f)}</div>
        </div>
      </section>`).join("");
    $("#view-detail").innerHTML = `
      <div class="detail-layout">
        <nav class="detail-nav" aria-label="分野の一覧">
          <h2>分野の一覧</h2>
          <div class="filter" role="group" aria-label="優先度で絞り込む">
            <button type="button" data-filter="all" aria-pressed="true">すべて</button>
            <button type="button" data-filter="high" aria-pressed="false">高</button>
            <button type="button" data-filter="mid" aria-pressed="false">中</button>
            <button type="button" data-filter="low" aria-pressed="false">低</button>
          </div>
          <div class="nav-groups">${groups}</div>
        </nav>
        <div class="detail-body">
          <div class="page-head">
            <h1>分野別詳細</h1>
            <p>16分野それぞれの、中分類と用語（1文の説明つき）・試験対策・ほかの分野とのつながり。<span class="badge sup">補</span>は公式文書にない補足、<span class="badge new">新案</span>は新制度のシラバス案だけにある用語。</p>
            <p class="notice">作成日（調査日）：${esc(META.created)}。${esc(META.notice)}</p>
          </div>
          ${sections}
        </div>
      </div>`;
    $$("[data-filter]", $("#view-detail")).forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.filter)));
  }
  function setFilter(v) {
    detailFilter = v;
    $$("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === v)));
    $$(".fsec, .nav-list li").forEach((x) => { x.hidden = v !== "all" && x.dataset.pri !== v; });
  }

  // ---------- 分野間の関係 ----------
  const MINI = { size: 640, r: 236 };
  function miniPos(id) {
    const p = posById[id];
    const c = MINI.size / 2;
    return { i: p.i, ang: p.ang, cx: c + MINI.r * Math.cos(rad(p.ang)), cy: c + MINI.r * Math.sin(rad(p.ang)) };
  }
  function miniAnchor(p, gap, tangent) {
    const c = MINI.size / 2;
    const dx = c - p.cx, dy = c - p.cy, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const rr = 20 + gap;
    return { x: p.cx + ux * rr - uy * tangent, y: p.cy + uy * rr + ux * tangent };
  }
  function buildLinks() {
    const s = MINI.size, c = s / 2, scale = MINI.r / L.radius;
    let mini = `<svg class="mini" id="mini" viewBox="-160 -10 ${s + 320} ${s + 20}" role="img" aria-label="16分野を円に並べ、関係を矢印で示した縮小図">`;
    mini += `<circle cx="${c}" cy="${c}" r="${MINI.r}" fill="none" stroke="var(--grid)" stroke-dasharray="4 6"/>`;
    mini += `<circle cx="${c}" cy="${c}" r="44" fill="var(--center)"/><text x="${c}" y="${c + 6}" text-anchor="middle" fill="#fff" font-size="16" font-weight="700">RISS</text>`;
    RELS.forEach((r) => {
      const g = relGeometry(r, scale * 0.95, c, miniPos, (p, gap, tan) => miniAnchor(p, gap * 0.4, tan * 0.5));
      const size = r.core ? 13 : 10;
      mini += `<g class="mini-rel${r.core ? " core" : ""}" data-id="${r.id}"><path d="M${g.p0.x.toFixed(1)},${g.p0.y.toFixed(1)} Q${g.c.x.toFixed(1)},${g.c.y.toFixed(1)} ${g.p2.x.toFixed(1)},${g.p2.y.toFixed(1)}"/>`;
      mini += `<polygon points="${arrowHead(g.p2, g.c, size)}"/>`;
      if (r.dir === "both") mini += `<polygon points="${arrowHead(g.p0, g.c, size)}"/>`;
      mini += `</g>`;
    });
    FIELDS.forEach((f) => {
      const p = miniPos(f.id);
      const lx = c + (MINI.r + 30) * Math.cos(rad(p.ang)), ly = c + (MINI.r + 30) * Math.sin(rad(p.ang));
      const cosv = Math.cos(rad(p.ang));
      const anchorTxt = Math.abs(cosv) < 0.3 ? "middle" : (cosv > 0 ? "start" : "end");
      mini += `<g class="mini-node" data-id="${f.id}" style="--c:${fcolor(f.id)}"><circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="18"/>`;
      mini += `<text x="${lx.toFixed(1)}" y="${(ly + 7).toFixed(1)}" text-anchor="${anchorTxt}">${esc(f.short)}</text></g>`;
    });
    mini += `</svg>`;

    const card = (r) => `
      <button type="button" class="rel-card" data-rel-card="${r.id}" aria-pressed="false">
        <span class="rc-head"><span class="chip"><span class="swatch" style="--c:${fcolor(r.from)}"></span>${esc(byId[r.from].short)}</span>
        <span class="rc-arrow">${r.dir === "both" ? "⇄" : "→"}</span>
        <span class="chip"><span class="swatch" style="--c:${fcolor(r.to)}"></span>${esc(byId[r.to].short)}</span>
        <span class="kind${r.core ? " core" : ""}">${r.core ? "重要な7関係" : "関係"}</span></span>
        <span class="rc-label">${esc(r.label)}</span>
        <dl><dt>なぜつながるか</dt><dd>${esc(r.why)}</dd><dt>具体例</dt><dd>${esc(r.example)}</dd><dt>試験での現れ方</dt><dd>${esc(r.exam)}</dd></dl>
      </button>`;
    const themed = DATA.themes.map((t, i) => {
      const rels = [RELS.find((r) => r.id === t.core), ...RELS.filter((r) => r.theme === t.id && r.id !== t.core)];
      return `<div class="rel-group"><h2><span class="num">${i + 1}</span>${esc(t.title)}</h2><div class="rel-cards">${rels.map(card).join("")}</div></div>`;
    }).join("");
    const others = RELS.filter((r) => r.theme === "other");
    const otherHTML = others.length ? `<div class="rel-group"><h2><span class="num">＋</span>そのほかの関係</h2><div class="rel-cards">${others.map(card).join("")}</div></div>` : "";

    const T = DATA.tables;
    const cloud = `<div><h2>${esc(T.cloudCompare.title)}</h2><div class="tbl-wrap"><table>
      <thead><tr>${T.cloudCompare.columns.map((c2) => `<th scope="col">${esc(c2)}</th>`).join("")}</tr></thead>
      <tbody>${T.cloudCompare.rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div></div>`;
    const pairs = `<div><h2>${esc(T.pairs.title)}（${T.pairs.items.length}組）</h2><div class="pairs">${T.pairs.items.map((p) => `
      <div class="pair"><h3>${esc(p.title)}</h3><dl>${p.items.map(([n, d]) => `<dt>${esc(n)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>
      <p class="point">${esc(p.point)}</p><div class="chips" style="margin-top:6px">${(p.fields || []).map(chipHTML).join("")}</div></div>`).join("")}</div></div>`;

    $("#view-links").innerHTML = `
      <div class="links-layout">
        <div class="page-head">
          <h1>分野間の関係</h1>
          <p>16分野をつなぐ${RELS.length}本の関係。はじめに重要な7つのテーマごとに並べ、そのあとに比較表を載せた。カードを選ぶと、縮小図の該当する矢印と両端の分野が強調される。</p>
        </div>
        <div class="mini-wrap">${mini}<p>太い実線＝重要な7関係、破線＝そのほかの関係。矢じりは影響の向き。</p></div>
        <div class="rel-groups">${themed}${otherHTML}</div>
        <div class="tables">${cloud}${pairs}</div>
      </div>`;
    $$("[data-rel-card]").forEach((b) => b.addEventListener("click", () => selectMini(b.dataset.relCard)));
  }
  function selectMini(rid) {
    const mini = $("#mini");
    const cur = $(".rel-card.sel");
    const same = cur && cur.dataset.relCard === rid;
    $$(".rel-card").forEach((b) => { b.classList.toggle("sel", !same && b.dataset.relCard === rid); b.setAttribute("aria-pressed", String(!same && b.dataset.relCard === rid)); });
    if (same) { mini.classList.remove("sel"); $$(".on", mini).forEach((x) => x.classList.remove("on")); return; }
    const r = RELS.find((x) => x.id === rid);
    mini.classList.add("sel");
    $$(".mini-rel", mini).forEach((g) => g.classList.toggle("on", g.dataset.id === rid));
    $$(".mini-node", mini).forEach((g) => g.classList.toggle("on", g.dataset.id === r.from || g.dataset.id === r.to));
    if (window.matchMedia("(max-width: 860px)").matches) {
      $(".mini-wrap").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  // ---------- 試験制度と根拠 ----------
  function buildExam() {
    const statusLabel = { done: "実施済み", next: "次回", plan: "予定" };
    const sysLabel = { current: "現行制度", new: "新制度" };
    const tl = META.timeline.map((t) => `
      <li class="${t.status}"><div class="tl-when">${esc(t.when)}</div>
      <div class="tl-name">${esc(t.name)} <span class="status ${t.status}">${statusLabel[t.status]}</span><span class="sys ${t.system}">${sysLabel[t.system]}</span></div>
      <p class="tl-text">${esc(t.text)}</p></li>`).join("");
    const cmp = META.compare.map((r) => `<tr><th scope="row">${esc(r.aspect)}</th><td>${esc(r.current)}</td><td>${esc(r.new)}</td></tr>`).join("");
    const a2 = (rows) => `<div class="tbl-wrap"><table><thead><tr><th scope="col">中分類</th><th scope="col">記号</th><th scope="col">この地図の分野</th></tr></thead><tbody>${rows.map((r) =>
      `<tr><th scope="row">${esc(r.code)} ${esc(r.name)}${r.note ? `<div style="font-weight:400;font-size:12px;color:var(--ink-3);white-space:normal">${esc(r.note)}</div>` : ""}</th><td>${esc(r.mark)}</td><td><div class="chips">${r.fields.map(chipHTML).join("")}</div></td></tr>`).join("")}</tbody></table></div>`;
    const bs = META.bScope.map((r) => `<tr><th scope="row">${r.no}. ${esc(r.current)}</th><td>${esc(r.items)}</td><td><div class="chips">${r.fields.map(chipHTML).join("")}</div></td><td>${esc(r.newChange)}</td></tr>`).join("");
    const pri = FIELDS.map((f) => `<tr><th scope="row"><a class="chip" href="#detail" data-goto-field="${f.id}"><span class="swatch" style="--c:${fcolor(f.id)}"></span>${esc(f.short)}</a></th><td>${pillHTML(f.priority)} ${badgeHTML(f)}</td><td>${esc(f.priorityReason)}</td></tr>`).join("");
    const recent = META.recentB.map((q) => `<tr><th scope="row">${esc(q.label)}</th><td>${esc(q.theme)}</td><td>${esc(q.tech)}</td><td><div class="chips">${q.fields.map(chipHTML).join("")}</div></td><td>${esc(q.note)}</td></tr>`).join("");
    const guide = META.readingGuide.map((g) => `<div><span class="lv">${esc(g.level)}</span><b>${esc(g.name)}</b>${esc(g.text)}</div>`).join("");
    const src = META.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> <span class="src-note">— ${esc(s.note)}</span></li>`).join("");
    $("#view-exam").innerHTML = `
      <div class="exam-wrap">
        <div class="page-head">
          <h1>試験制度と根拠</h1>
          <p>この地図の前提にした試験制度・日程・出題範囲と、優先度の根拠。<strong>現行制度</strong>と<strong>新制度（検討段階）</strong>は分けて書いている。</p>
          <p class="notice">作成日（調査日）：${esc(META.created)}。${esc(META.notice)}</p>
        </div>
        <section aria-labelledby="ex-tl"><h2 id="ex-tl">受験時期のタイムライン</h2><ol class="timeline">${tl}</ol></section>
        <section aria-labelledby="ex-cmp"><h2 id="ex-cmp">現行制度と新制度の比較</h2>
          <div class="tbl-wrap"><table><thead><tr><th scope="col">観点</th><th scope="col">現行制度（令和8年度まで）</th><th scope="col">新制度（2027年度〜予定・検討段階）</th></tr></thead><tbody>${cmp}</tbody></table></div></section>
        <section aria-labelledby="ex-a2"><h2 id="ex-a2">科目A-2の出題分野と、この地図の分野</h2>
          <div class="two-col"><div><h3>現行制度（試験要綱 Ver.5.6）</h3>${a2(META.a2Current)}</div><div><h3>新制度（出題範囲等の改定案 Ver.1.0）</h3>${a2(META.a2New)}</div></div>
          <ul>${META.a2Notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>
        <section aria-labelledby="ex-b"><h2 id="ex-b">科目Bの出題範囲（大項目）と、この地図の分野</h2>
          <div class="tbl-wrap"><table><thead><tr><th scope="col">大項目（現行）</th><th scope="col">主な内容</th><th scope="col">この地図の分野</th><th scope="col">新制度での変更（改定案）</th></tr></thead><tbody>${bs}</tbody></table></div></section>
        <section aria-labelledby="ex-pri"><h2 id="ex-pri">優先度の決め方</h2>
          <ul class="method">${META.priorityMethod.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
          <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th scope="col">分野</th><th scope="col">優先度</th><th scope="col">根拠</th></tr></thead><tbody>${pri}</tbody></table></div></section>
        <section aria-labelledby="ex-recent"><h2 id="ex-recent">直近5回の科目B（午後）の出題テーマ</h2>
          <p>令和5年度秋期〜令和7年度秋期（午後Ⅰ・Ⅱの統合後）。テーマは各回の出題趣旨と採点講評を要約したもの。令和8年度以降はCBT化により問題が公開されない。</p>
          <div class="tbl-wrap"><table><thead><tr><th scope="col">回・問</th><th scope="col">テーマ</th><th scope="col">主な技術要素</th><th scope="col">この地図の分野</th><th scope="col">採点講評から</th></tr></thead><tbody>${recent}</tbody></table></div></section>
        <section aria-labelledby="ex-guide"><h2 id="ex-guide">地図の読み方</h2><div class="guide">${guide}</div></section>
        <section aria-labelledby="ex-src"><h2 id="ex-src">出典（いずれも ${esc(META.created)} に確認）</h2><ol class="src-list">${src}</ol></section>
        <p class="footer-note">IPAの文書は要点を自分の言葉でまとめ、出典をリンクで示している。用語の説明もオリジナル。最新情報は必ずIPAの公式サイトで確認すること。</p>
      </div>`;
  }

  // ---------- 用語検索 ----------
  const INDEX = [];
  FIELDS.forEach((f) => {
    INDEX.push({ kind: "field", label: f.name, keys: [f.name, f.short], field: f });
    f.subs.forEach((s) => {
      INDEX.push({ kind: "sub", label: s.name, keys: [s.name], field: f, sub: s });
      s.terms.forEach((t) => INDEX.push({ kind: "term", label: t.name, keys: [t.name, ...t.aka], desc: t.desc, field: f, sub: s, term: t }));
    });
  });
  INDEX.forEach((x) => { x.nk = x.keys.map(norm); x.nd = norm(x.desc || ""); });
  const qInput = $("#q"), qList = $("#q-list");
  let qResults = [], qActive = -1;
  function searchItems(q) {
    const n = norm(q);
    if (!n) return [];
    const scored = [];
    INDEX.forEach((x) => {
      let s = 0;
      if (x.nk.some((k) => k === n)) s = 100;
      else if (x.nk.some((k) => k.startsWith(n))) s = 80;
      else if (x.nk.some((k) => k.includes(n))) s = 60;
      else if (n.length >= 2 && x.nd.includes(n)) s = 20;
      if (s) scored.push({ x, s: s + (x.kind === "term" ? 2 : x.kind === "sub" ? 1 : 0) });
    });
    scored.sort((a, b) => b.s - a.s || a.x.label.length - b.x.label.length);
    return scored.map((o) => o.x);
  }
  function renderSearch() {
    const q = qInput.value.trim();
    const all = searchItems(q);
    state.hits = new Set(all.filter((x) => x.kind !== "term" || x.nd !== undefined).filter((x) => x.nk.some((k) => k.includes(norm(q)))).map((x) => x.field.id));
    refreshFocus();
    qResults = all.slice(0, 12);
    qActive = -1;
    if (!q) { qList.hidden = true; qInput.setAttribute("aria-expanded", "false"); return; }
    const info = `<li class="q-info" role="presentation">${all.length ? `${all.length}件${all.length > 12 ? "（上位12件）" : ""}。地図上で該当する分野をオレンジの破線で囲んでいる` : "見つかりませんでした"}</li>`;
    qList.innerHTML = info + qResults.map((x, i) => {
      const path = x.kind === "term" ? `${x.field.short} › ${x.sub.name}` : x.kind === "sub" ? `${x.field.short}（中分類）` : "大分類";
      return `<li role="option" id="qo-${i}" data-i="${i}" aria-selected="false"><span class="q-name">${esc(x.label)}</span>${x.term ? termBadges(x.term) : ""}<span class="q-path">${esc(path)}</span></li>`;
    }).join("");
    qList.hidden = false;
    qInput.setAttribute("aria-expanded", "true");
  }
  function setActive(i) {
    const opts = $$("[role=option]", qList);
    if (!opts.length) return;
    qActive = (i + opts.length) % opts.length;
    opts.forEach((o, j) => o.setAttribute("aria-selected", String(j === qActive)));
    qInput.setAttribute("aria-activedescendant", `qo-${qActive}`);
    opts[qActive].scrollIntoView({ block: "nearest" });
  }
  function chooseResult(i) {
    const x = qResults[i];
    if (!x) return;
    qList.hidden = true;
    qInput.setAttribute("aria-expanded", "false");
    if (x.kind === "term") gotoTerm(x.term.id, x.field.id);
    else gotoField(x.field.id);
  }
  qInput.addEventListener("input", renderSearch);
  qInput.addEventListener("focus", () => { if (qInput.value.trim()) renderSearch(); });
  qInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(qActive + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(qActive - 1); }
    else if (e.key === "Enter") { e.preventDefault(); chooseResult(qActive >= 0 ? qActive : 0); }
    else if (e.key === "Escape") { if (!qList.hidden) { e.stopPropagation(); qList.hidden = true; qInput.setAttribute("aria-expanded", "false"); } }
  });
  qList.addEventListener("pointerdown", (e) => e.preventDefault());
  qList.addEventListener("click", (e) => {
    const li = e.target.closest("[role=option]");
    if (li) chooseResult(Number(li.dataset.i));
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) { qList.hidden = true; qInput.setAttribute("aria-expanded", "false"); }
  });

  // ---------- 画面の切り替え（#map #detail #links #exam） ----------
  const TABS = ["map", "detail", "links", "exam"];
  const built = {};
  let pendingScroll = null;
  function showTab(name) {
    if (!TABS.includes(name)) name = "map";
    if (name !== "map" && !built[name]) {
      ({ detail: buildDetail, links: buildLinks, exam: buildExam })[name]();
      built[name] = true;
    }
    TABS.forEach((t) => {
      $(`#view-${t}`).hidden = t !== name;
      const tab = $(`#tab-${t}`);
      tab.setAttribute("aria-selected", String(t === name));
      tab.setAttribute("tabindex", t === name ? "0" : "-1");
    });
    if (name !== "map") closePanel();
    if (name === "map" && view.auto) requestAnimationFrame(fit);
    if (pendingScroll) { const fn = pendingScroll; pendingScroll = null; requestAnimationFrame(fn); }
  }
  function currentTab() { return (location.hash || "#map").slice(1).split("/")[0]; }
  function goTab(name, after) {
    pendingScroll = after || null;
    if (currentTab() === name) showTab(name);
    else location.hash = name;
  }
  function gotoField(fid) {
    goTab("detail", () => {
      if (detailFilter !== "all") setFilter("all");
      const sec = $(`#f-${fid}`);
      if (sec) { sec.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }); $("h2", sec).setAttribute("tabindex", "-1"); $("h2", sec).focus({ preventScroll: true }); }
    });
  }
  function gotoTerm(tid) {
    goTab("detail", () => {
      if (detailFilter !== "all") setFilter("all");
      const t = $(`#t-${tid}`);
      if (!t) return;
      t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      t.classList.add("flash");
      setTimeout(() => t.classList.remove("flash"), 2600);
    });
  }
  window.addEventListener("hashchange", () => showTab(currentTab()));
  $(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.indexOf(currentTab());
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    location.hash = next;
    $(`#tab-${next}`).focus();
  });

  // パネル・各画面の中のボタン（委譲）
  document.addEventListener("click", (e) => {
    const gf = e.target.closest("[data-goto-field]");
    if (gf) { e.preventDefault(); gotoField(gf.dataset.gotoField); return; }
    const of = e.target.closest("[data-open-field]");
    if (of) { e.preventDefault(); openField(of.dataset.openField); return; }
    const orl = e.target.closest("[data-open-rel]");
    if (orl) { e.preventDefault(); openRelation(orl.dataset.openRel); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  // ---------- 表示色の切り替え ----------
  const root = document.documentElement;
  const saved = store.get("riss-map-theme");
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    store.set("riss-map-theme", root.dataset.theme);
  });

  // ---------- 開始 ----------
  function syncTopbar() {
    const h = $("#topbar").getBoundingClientRect().height;
    root.style.setProperty("--topbar-actual", `${h}px`);
  }
  buildLegend();
  buildA1Note();
  syncTopbar();
  window.addEventListener("resize", () => { syncTopbar(); if (view.auto) fit(); });
  showTab(currentTab());
  fit();
  fitCompactText();
  refreshFocus();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitCompactText(); if (view.auto) fit(); });
  // 検証用：外から状態を読めるようにする（画面の動作には影響しない）
  window.__rissMap = { view, fit, openField, openRelation, gotoTerm, POS, closePanel };
})();
