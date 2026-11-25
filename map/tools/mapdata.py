"""地図のデータ（map/data/*.yml）を読み込み、描画用の形にそろえる共通モジュール。"""
from __future__ import annotations

import math
import re
import unicodedata
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]          # map/
DATA = ROOT / "data"


def _load(path: Path):
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def parse_term(raw, field_id: str, sub_id: str, index: int) -> dict:
    """[名前, 説明, {オプション}] の形の用語を辞書にする。"""
    if not isinstance(raw, list) or len(raw) < 2:
        raise ValueError(f"{field_id}/{sub_id} の {index + 1} 番目の用語の形が不正です: {raw!r}")
    name, desc = str(raw[0]), str(raw[1])
    opts = raw[2] if len(raw) > 2 and isinstance(raw[2], dict) else {}
    return {
        "id": f"{field_id}-{sub_id}-{index + 1}",
        "name": name,
        "desc": desc,
        "sup": bool(opts.get("sup", False)),     # True = 公式文書に記載なし（「補」バッジ）
        "new": bool(opts.get("new", False)),     # True = 新制度のシラバス案にだけ記載（「新案」バッジ）
        "aka": [str(a) for a in opts.get("aka", [])],
        "note": opts.get("note"),
        "checked": bool(opts.get("checked", False)),  # 照合結果を人が確認して上書きした
    }


def load_all() -> dict:
    meta = _load(DATA / "meta.yml")
    domains = _load(DATA / "domains.yml")
    rel = _load(DATA / "relations.yml")
    tables = _load(DATA / "tables.yml")
    fields = []
    for p in sorted((DATA / "fields").glob("*.yml")):
        f = _load(p)
        f["_file"] = p.name
        subs = []
        for s in f.get("subs", []):
            sid = s["id"]
            terms = [parse_term(t, f["id"], sid, i) for i, t in enumerate(s.get("terms", []))]
            subs.append({"id": f"{f['id']}-{sid}", "name": s["name"], "terms": terms})
        f["subs"] = subs
        fields.append(f)
    fields.sort(key=lambda x: x["order"])
    return {
        "meta": meta,
        "domains": domains,
        "fields": fields,
        "themes": rel["themes"],
        "relations": rel["relations"],
        "tables": tables,
    }


# ---------- 文字数・色・配置の計算（check.py と build.py の両方で使う） ----------

def zen_len(s: str) -> float:
    """全角を1、半角を0.5として数えた長さ。"""
    n = 0.0
    for ch in s:
        n += 1.0 if unicodedata.east_asian_width(ch) in ("F", "W", "A") else 0.5
    return n


def _lin(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def card_height(layout: dict, n_subs: int) -> float:
    return layout["cardHeader"] + layout["cardPad"] + layout["cardRow"] * n_subs + layout["cardFooter"]


def card_rects(data: dict) -> list[dict]:
    """各大分類カードの中心と矩形（app.js と同じ式）。"""
    lay = data["meta"]["layout"]
    n = len(data["fields"])
    c = lay["size"] / 2
    out = []
    for i, f in enumerate(data["fields"]):
        ang = math.radians(lay["startAngle"] + 360 * i / n)
        cx = c + lay["radius"] * math.cos(ang)
        cy = c + lay["radius"] * math.sin(ang)
        w = lay["cardWidth"]
        h = card_height(lay, len(f["subs"]))
        out.append({"id": f["id"], "cx": cx, "cy": cy, "x": cx - w / 2, "y": cy - h / 2, "w": w, "h": h})
    return out


REF_RE = re.compile(r"(R\d+[春秋])\s*問(\d)((?:・問\d)*)")
SAMPLE_RE = re.compile(r"サンプル問(\d)")


def exam_refs(text: str) -> list[str]:
    """文章中の「R7秋 問2」「R6春 問1・問3」「サンプル問1」を ID の一覧にする。"""
    ids = []
    for m in REF_RE.finditer(text or ""):
        ids.append(f"{m.group(1)}-{m.group(2)}")
        for extra in re.findall(r"問(\d)", m.group(3)):
            ids.append(f"{m.group(1)}-{extra}")
    for m in SAMPLE_RE.finditer(text or ""):
        ids.append(f"サンプル-{m.group(1)}")
    return ids
