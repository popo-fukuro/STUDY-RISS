"""地図データの整合性チェック。問題があれば終了コード1で終わる。

    python map/tools/check.py
"""
from __future__ import annotations

import itertools
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mapdata import card_rects, contrast, exam_refs, load_all, zen_len  # noqa: E402

REQUIRED_FIELD_KEYS = [
    "id", "order", "domain", "color", "name", "short", "priority", "summary", "themes",
    "keywords", "examA2", "examB", "official", "priorityReason", "subs",
]
REQUIRED_PAIRS = [  # 依頼で指定された7つの関係（順不同の組）
    {"crypto", "auth"}, {"netbase", "threats"}, {"vuln", "web"}, {"osdb", "web"},
    {"ops", "incident"}, {"netdef", "risk"}, {"cloud", "osdb"},
]
WHITE = "#FFFFFF"

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def main() -> int:
    d = load_all()
    meta, fields, rels = d["meta"], d["fields"], d["relations"]
    fids = [f["id"] for f in fields]
    dom_ids = [x["id"] for x in d["domains"]]
    fmap = {f["id"]: f for f in fields}

    # ---- ID の重複 ----
    all_ids = (
        dom_ids + fids + [s["id"] for f in fields for s in f["subs"]]
        + [r["id"] for r in rels] + [t["id"] for t in d["themes"]]
        + [p["id"] for p in d["tables"]["pairs"]["items"]]
        + [t["id"] for f in fields for s in f["subs"] for t in s["terms"]]
    )
    for k, n in Counter(all_ids).items():
        if n > 1:
            err(f"ID が重複しています: {k}（{n}回）")

    # ---- 大分類 ----
    if not 14 <= len(fields) <= 18:
        err(f"大分類の数が16前後ではありません: {len(fields)}")
    orders = [f["order"] for f in fields]
    if orders != list(range(1, len(fields) + 1)):
        err(f"order が1からの連番になっていません: {orders}")
    term_total = 0
    for f in fields:
        where = f"[{f.get('_file')}]"
        for k in REQUIRED_FIELD_KEYS:
            v = f.get(k)
            if v in (None, "", []):
                err(f"{where} 必須項目 {k} がありません")
        if f.get("domain") not in dom_ids:
            err(f"{where} domain が存在しません: {f.get('domain')}")
        if f.get("priority") not in ("high", "mid", "low"):
            err(f"{where} priority は high / mid / low のどれか: {f.get('priority')}")
        for b in f.get("badges", []):
            if b not in meta["badges"]:
                err(f"{where} 未定義のバッジ: {b}")
        if zen_len(f["short"]) > 10:
            err(f"{where} 短い名前が全角10字を超えています: {f['short']}（{zen_len(f['short'])}）")
        lines = f.get("shortLines")
        if lines and "".join(lines) != f["short"]:
            err(f"{where} shortLines をつなげても short になりません: {lines}")
        if not 4 <= len(f["subs"]) <= 6:
            err(f"{where} 中分類は4〜6個: {len(f['subs'])}")
        n_terms = 0
        for s in f["subs"]:
            if zen_len(s["name"]) > 12:
                err(f"{where} 中分類名が全角12字を超えています: {s['name']}（{zen_len(s['name'])}）")
            if not s["terms"]:
                err(f"{where} 中分類 {s['name']} に用語がありません")
            for t in s["terms"]:
                n_terms += 1
                if not t["desc"].endswith("。"):
                    warn(f"{where} 用語の説明が「。」で終わっていません: {t['name']}")
                if t["sup"] and t["new"]:
                    err(f"{where} 補と新案は同時に付けられません: {t['name']}")
                if t["note"] and not (Path(__file__).resolve().parents[2] / "docs" / t["note"]).exists():
                    err(f"{where} note のノートが見つかりません: {t['note']}")
        names = [t["name"] for s in f["subs"] for t in s["terms"]]
        for k, n in Counter(names).items():
            if n > 1:
                err(f"{where} 同じ分野に同じ用語が重複: {k}")
        if not 16 <= n_terms <= 30:
            warn(f"{where} 用語数が20前後から外れています: {n_terms}")
        term_total += n_terms
        if contrast(f["color"], WHITE) < 4.5:
            err(f"{where} 分野色 {f['color']} と白文字のコントラストが4.5未満: {contrast(f['color'], WHITE):.2f}")

    for dm in d["domains"]:
        if contrast(dm["color"], WHITE) < 4.5:
            err(f"領域 {dm['id']} の色と白文字のコントラストが4.5未満")
    # 領域ごとに大分類が連続しているか（扇形の色面を1つにするため）
    seq = [f["domain"] for f in fields]
    seen = []
    for x in seq:
        if not seen or seen[-1] != x:
            if x in seen:
                err(f"領域 {x} の大分類が円周上で連続していません")
            seen.append(x)
    if len(seen) != 6:
        err(f"領域の数が6ではありません: {len(seen)}")

    # ---- 試験の参照（優先度の根拠・関係の現れ方） ----
    exam_index = {q["id"]: q for q in meta["recentB"] + meta["sampleB"]}
    for q in meta["recentB"] + meta["sampleB"]:
        for fid in q["fields"]:
            if fid not in fmap:
                err(f"recentB/sampleB {q['id']} の fields に存在しない分野: {fid}")
    for f in fields:
        for key in ("priorityReason", "examB"):
            for ref in exam_refs(f.get(key, "")):
                q = exam_index.get(ref)
                if q is None:
                    err(f"[{f['id']}] {key} の参照 {ref} が meta.yml にありません")
                elif f["id"] not in q["fields"]:
                    err(f"[{f['id']}] {key} の参照 {ref} の fields に {f['id']} が含まれていません")
        if f["priority"] == "high" and not exam_refs(f["priorityReason"]):
            warn(f"[{f['id']}] 優先度「高」なのに直近の科目Bの参照がありません")
    for key in ("a2Current", "a2New", "bScope"):
        for row in meta[key]:
            for fid in row["fields"]:
                if fid not in fmap:
                    err(f"meta.{key} に存在しない分野: {fid}")

    # ---- 関係 ----
    theme_ids = {t["id"] for t in d["themes"]} | {"other"}
    pairs_found = []
    for r in rels:
        if r["from"] not in fmap or r["to"] not in fmap:
            err(f"関係 {r['id']} の端が存在しません: {r['from']} → {r['to']}")
        if r["from"] == r["to"]:
            err(f"関係 {r['id']} の両端が同じです")
        if r.get("dir") not in ("one", "both"):
            err(f"関係 {r['id']} の dir は one / both: {r.get('dir')}")
        for k in ("label", "why", "example", "exam"):
            if not r.get(k):
                err(f"関係 {r['id']} に {k} がありません")
        if zen_len(r.get("label", "")) > 14:
            warn(f"関係 {r['id']} のラベルが長め（全角14字超）: {r['label']}")
        if r.get("theme") not in theme_ids:
            err(f"関係 {r['id']} の theme が不正: {r.get('theme')}")
        for ref in exam_refs(r.get("exam", "")):
            q = exam_index.get(ref)
            if q is None:
                err(f"関係 {r['id']} の参照 {ref} が meta.yml にありません")
            elif not ({r["from"], r["to"]} & set(q["fields"])):
                err(f"関係 {r['id']} の参照 {ref} が両端のどちらの分野にも対応していません")
        if r.get("core"):
            pairs_found.append({r["from"], r["to"]})
    for p in REQUIRED_PAIRS:
        if p not in pairs_found:
            err(f"指定の関係がありません（core: true）: {' と '.join(sorted(p))}")
    if len(pairs_found) != 7:
        err(f"core: true の関係が7本ではありません: {len(pairs_found)}")
    for t in d["themes"]:
        core = next((r for r in rels if r["id"] == t["core"]), None)
        if core is None or not core.get("core"):
            err(f"テーマ {t['id']} の core 関係が見つからないか core: true ではありません")
    keys = Counter(frozenset((r["from"], r["to"])) for r in rels)
    for k, n in keys.items():
        if n > 1:
            err(f"同じ2分野の関係が重複しています: {sorted(k)}")
    if not 15 <= len(rels) <= 20:
        warn(f"関係の数が「7＋10前後」から外れています: {len(rels)}")

    # ---- 表 ----
    pairs = d["tables"]["pairs"]["items"]
    if not 18 <= len(pairs) <= 26:
        warn(f"似た概念の組の数が20前後から外れています: {len(pairs)}")
    for p in pairs:
        for fid in p.get("fields", []):
            if fid not in fmap:
                err(f"比較 {p['id']} に存在しない分野: {fid}")
    for row in d["tables"]["cloudCompare"]["rows"]:
        if len(row) != len(d["tables"]["cloudCompare"]["columns"]):
            err(f"クラウド比較表の列数が合いません: {row[0]}")

    # ---- カードの配置（重なり） ----
    lay = meta["layout"]
    rects = card_rects(d)
    margin = 24
    min_gap = None
    for a, b in itertools.combinations(rects, 2):
        gx = max(b["x"] - (a["x"] + a["w"]), a["x"] - (b["x"] + b["w"]))
        gy = max(b["y"] - (a["y"] + a["h"]), a["y"] - (b["y"] + b["h"]))
        gap = max(gx, gy)        # 正なら離れている
        min_gap = gap if min_gap is None else min(min_gap, gap)
        if gap < margin:
            err(f"カードが重なる／近すぎる: {a['id']} と {b['id']}（すき間 {gap:.1f}）")
    for r in rects:
        if r["x"] < 0 or r["y"] < 0 or r["x"] + r["w"] > lay["size"] or r["y"] + r["h"] > lay["size"]:
            err(f"カードが座標空間からはみ出しています: {r['id']}")
        # 中心の円とカードが重ならないこと
        c = lay["size"] / 2
        nx = min(max(c, r["x"]), r["x"] + r["w"])
        ny = min(max(c, r["y"]), r["y"] + r["h"])
        if (nx - c) ** 2 + (ny - c) ** 2 < (lay["centerRadius"] + 40) ** 2:
            err(f"カードが中心の円に近すぎます: {r['id']}")
        # 領域名の円弧より内側にあること
        far = max(((x - c) ** 2 + (y - c) ** 2) ** 0.5
                  for x in (r["x"], r["x"] + r["w"]) for y in (r["y"], r["y"] + r["h"]))
        if far > lay["ringLabel"] - 40:
            err(f"カードの角が領域名の円弧に近すぎます: {r['id']}（{far:.0f}）")

    # ---- 調査メモとの照合（試験制度・日程・出題分野・優先度の根拠） ----
    memo_path = Path(__file__).resolve().parents[1] / meta.get("researchMemo", "")
    if not memo_path.is_file():
        err(f"調査メモが見つかりません: {memo_path}")
    else:
        memo = memo_path.read_text(encoding="utf-8")
        meta_text = (Path(__file__).resolve().parents[1] / "data" / "meta.yml").read_text(encoding="utf-8")
        if meta["created"] not in memo:
            err(f"作成日 {meta['created']} が調査メモの確認日と一致しません")
        # 日程・試験時間・出題数などの事実は、両方に同じ表記で書かれていること
        facts = ["2027/1/27", "2/27", "2/20", "3/2", "3/16", "3/28", "10/17", "10/27", "11/11", "11/23",
                 "45分", "35分", "120分", "12問", "1問1答", "1問3答", "夏頃", "2026年度"]
        for fact in facts:
            if fact not in memo:
                err(f"調査メモに「{fact}」がありません")
            if fact not in meta_text:
                err(f"meta.yml に「{fact}」がありません")
        # 科目A-2（現行）：中分類ごとの記号
        for row in meta["a2Current"]:
            line = next((ln for ln in memo.splitlines() if ln.startswith(f"| {row['code']} {row['name']} |")), None)
            if line is None:
                err(f"調査メモの科目A-2の表に「{row['code']} {row['name']}」がありません")
            elif row["mark"] not in line:
                err(f"科目A-2「{row['name']}」の記号が調査メモと違います: ページ {row['mark']} / メモ {line}")
        # 科目A-2（新制度）：●と○の中分類番号
        def memo_codes(marker: str) -> set[str]:
            ln = next((x for x in memo.splitlines() if marker in x), "")
            body = ln.split("：", 1)[1] if "：" in ln else ""
            return set(re.findall(r"(\d+)", body))
        for mark, marker in (("●", "**●（専門分野かつ重点分野）**"), ("○", "  - ○：")):
            want = {r["code"] for r in meta["a2New"] if r["mark"] == mark}
            got = memo_codes(marker)
            if want != got:
                err(f"新制度の科目A-2の{mark}が調査メモと違います: ページ {sorted(want)} / メモ {sorted(got)}")
        # 直近の科目B：回・問の一覧
        for q in meta["recentB"]:
            if f"| {q['label']} |" not in memo:
                err(f"調査メモの直近の科目Bの表に {q['label']} がありません")
        memo_rows = re.findall(r"^\| (R\d+[春秋] 問\d) \|", memo, flags=re.M)
        if len(memo_rows) != len(meta["recentB"]):
            err(f"直近の科目Bの問数が違います: ページ {len(meta['recentB'])} / メモ {len(memo_rows)}")
        # 優先度の根拠の3つの観点が、調査メモの「優先度の判断に使う根拠」と同じであること
        for key in ("重点分野", "直近", "新制度"):
            if key not in "".join(meta["priorityMethod"]):
                err(f"優先度の決め方に「{key}」の観点がありません")
        print(f"調査メモとの照合: {memo_path.name}（事実 {len(facts)}件・科目A-2 {len(meta['a2Current'])}＋{len(meta['a2New'])}行・科目B {len(memo_rows)}問）")

    # ---- 結果 ----
    print(f"大分類 {len(fields)}・中分類 {sum(len(f['subs']) for f in fields)}・用語 {term_total}・"
          f"関係 {len(rels)}（指定 {len(pairs_found)}）・比較 {len(pairs)}組")
    print(f"隣り合うカードの最小のすき間: {min_gap:.1f}")
    for w in warnings:
        print("警告:", w)
    for e in errors:
        print("エラー:", e)
    print("OK" if not errors else f"NG（エラー {len(errors)}件）")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
