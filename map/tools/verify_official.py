"""用語の「補」「新案」フラグを、IPAの公式文書の本文と照合する（手元での確認用。CIでは使わない）。

    python map/tools/verify_official.py          # 食い違いだけを表示
    python map/tools/verify_official.py --all    # すべての用語の判定を表示
    python map/tools/verify_official.py --fix    # 食い違いを照合結果どおりに書き換える
  人の目で確認して照合結果と違う判定にしたい用語は、オプションに checked: true を付ける。

IPAのPDFは .cache/ipa/ にダウンロードする（.gitignore 済み。リポジトリには入れない）。
テキスト化には pdftotext（poppler-utils）を使う。

判定のしかた
  - 用語名・かっこ内・「／」で区切った各部分・aka のどれかが本文に含まれていれば「記載あり」。
    空白・改行を取り除き、全角半角をそろえて比べる。
  - 現行の文書（要綱 Ver.5.6、SCシラバス Ver.2.1、追補版 Ver.4.0、応用情報シラバス＝科目A-1）に記載 → 公式
  - 新制度の文書（SCシラバス案 Ver.0.1、科目A-1シラバス案、出題範囲の改定案）にだけ記載 → 新案
  - どれにもない → 補
  短い英字の略語は別の語の一部に偶然含まれることがあるので、結果は人の目でも確かめること。
"""
from __future__ import annotations

import re
import subprocess
import sys
import unicodedata
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mapdata import load_all  # noqa: E402

CACHE = Path(__file__).resolve().parents[2] / ".cache" / "ipa"
BASE = "https://www.ipa.go.jp/shiken/"
DOCS = {
    "current": [
        "syllabus/rcu1hd00000141gq-att/youkou_ver5_6.pdf",
        "syllabus/nq6ept00000014ir-att/syllabus_sc_ver2_1.pdf",
        "syllabus/nq6ept00000014hj-att/syllabus_sc_am2_tsuiho4_0.pdf",
        "syllabus/omgdg50000005kq5-att/syllabus_ap_ver7_2.pdf",
    ],
    "new": [
        "syllabus/minaoshi/rcu1hd000001g5rk-att/syllabus_sc_ver0_1.pdf",
        "syllabus/minaoshi/rqr7mi00000068t6-att/syllabus_pdsc_a-1_ver0_1.pdf",
        "syllabus/henkou/2025/rcu1hd0000008574-att/shinshiken-hani-kaiteian.pdf",
    ],
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub(r"\s+", "", s)
    return s.replace("ー", "ー").replace("－", "-")


def spaced(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    return re.sub(r"\s+", " ", s)


def corpus(kind: str) -> tuple[str, str]:
    CACHE.mkdir(parents=True, exist_ok=True)
    texts = []
    for rel in DOCS[kind]:
        pdf = CACHE / Path(rel).name
        if not pdf.exists():
            print(f"ダウンロード: {BASE}{rel}", file=sys.stderr)
            req = urllib.request.Request(BASE + rel, headers={"User-Agent": "study-map-checker"})
            with urllib.request.urlopen(req, timeout=60) as r:
                pdf.write_bytes(r.read())
        txt = pdf.with_suffix(".txt")
        if not txt.exists():
            subprocess.run(["pdftotext", str(pdf), str(txt)], check=True)
        texts.append(txt.read_text(encoding="utf-8", errors="ignore"))
    raw = "\n".join(texts)
    return norm(raw), spaced(raw)


def found(cand: str, corp: tuple[str, str]) -> bool:
    """英数字だけの語は単語の境界で、それ以外は空白を除いた本文で探す。"""
    if re.fullmatch(r"[a-z0-9 ./&+-]+", cand):
        return re.search(r"(?<![a-z0-9])" + re.escape(cand) + r"(?![a-z0-9])", corp[1]) is not None
    return norm(cand) in corp[0]


def candidates(term: dict) -> list[str]:
    name = term["name"]
    out = {name}
    m = re.match(r"^(.*?)（(.*?)）(.*)$", name)
    if m:
        out.add(m.group(1) + m.group(3))
        out.add(m.group(2))
    for part in list(out):
        for p in re.split(r"[／]", part):
            out.add(p)
    out.update(term["aka"])
    res = []
    for x in out:
        x = spaced(x).strip()
        if re.fullmatch(r"[a-z0-9 ./&+-]+", x):
            if len(x.replace(" ", "")) >= 3:   # 2文字以下の英字は誤一致が多いので使わない
                res.append(x)
        elif len(norm(x)) >= 2:
            res.append(x)
    return res


FLAG_RE = re.compile(r"^(\s*- \[)(.+)$")


def fix_flags(changes: dict[str, dict[str, str]]) -> None:
    """データの YAML の該当行に sup / new を書き込む（照合結果どおりに直す）。"""
    from mapdata import DATA
    for path in sorted((DATA / "fields").glob("*.yml")):
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        todo = changes.get(path.name, {})
        for i, line in enumerate(lines):
            m = FLAG_RE.match(line)
            if not m:
                continue
            name = m.group(2).split(",", 1)[0].strip()
            if name not in todo:
                continue
            body = line.rstrip("\n")
            body = re.sub(r"(,\s*)?\b(sup|new): true(,\s*)?", lambda mm: ", " if mm.group(1) and mm.group(3) else "", body)
            body = body.replace("{}", "").replace(", ]", "]").replace(",  ]", "]")
            body = re.sub(r",\s*\{\s*\}\]$", "]", body)
            flag = {"補": "sup: true", "新案": "new: true", "公式": ""}[todo[name]]
            if flag:
                if body.endswith("}]"):
                    body = body[:-2].rstrip() + (", " if not body[:-2].rstrip().endswith("{") else "") + flag + "}]"
                else:
                    body = body[:-1] + ", {" + flag + "}]"
            lines[i] = body + "\n"
        path.write_text("".join(lines), encoding="utf-8")


def main() -> int:
    show_all = "--all" in sys.argv
    cur, new = corpus("current"), corpus("new")
    d = load_all()
    mismatch = 0
    to_fix: dict[str, dict[str, str]] = {}
    for f in d["fields"]:
        for s in f["subs"]:
            for t in s["terms"]:
                cands = candidates(t)
                in_cur = any(found(c, cur) for c in cands)
                in_new = any(found(c, new) for c in cands)
                judged = "公式" if in_cur else ("新案" if in_new else "補")
                flagged = "補" if t["sup"] else ("新案" if t["new"] else "公式")
                bad = judged != flagged and not t.get("checked")
                mismatch += bad
                if bad:
                    to_fix.setdefault(f["_file"], {})[t["name"]] = judged
                if bad or show_all:
                    mark = "×" if bad else " "
                    print(f"{mark} {f['id']:9} {t['name']:<36} データ:{flagged:<3} 照合:{judged}")
    print(f"食い違い {mismatch} 件")
    if "--fix" in sys.argv and to_fix:
        fix_flags(to_fix)
        print("データのフラグを照合結果どおりに書き換えた。git diff で確認すること。")
    return 1 if mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
