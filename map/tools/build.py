"""地図のデータ（map/data）と画面の部品（map/src）から、単体で開ける HTML を作る。

    python map/tools/build.py           # docs/map/index.html を書き出す
    python map/tools/build.py --check   # 書き出し済みのファイルが最新かだけを確かめる（CI用）
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mapdata import ROOT, load_all  # noqa: E402

SRC = ROOT / "src"
OUT = ROOT.parent / "docs" / "map" / "index.html"


def render() -> str:
    d = load_all()
    for f in d["fields"]:
        f.pop("_file", None)
        for s in f["subs"]:
            for t in s["terms"]:
                t.pop("checked", None)
    meta = d["meta"]
    css_vars = [":root {"]
    css_vars += [f"  --d-{x['id']}: {x['color']};" for x in d["domains"]]
    css_vars += [f"  --f-{f['id']}: {f['color']};" for f in d["fields"]]
    css_vars.append("}")
    data_json = json.dumps(d, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
    tpl = (SRC / "template.html").read_text(encoding="utf-8")
    css = (SRC / "style.css").read_text(encoding="utf-8")
    js = (SRC / "app.js").read_text(encoding="utf-8")
    desc = f"{meta['subtitle']}。16分野・中分類・用語と分野間の関係を放射状の地図で示す。作成日 {meta['created']}。"
    out = (tpl.replace("{{TITLE}}", html.escape(meta["title"]))
              .replace("{{SUBTITLE}}", html.escape(meta["subtitle"]))
              .replace("{{DESC}}", html.escape(desc))
              .replace("/*{{VARS}}*/", "\n".join(css_vars))
              .replace("/*{{CSS}}*/", css)
              .replace("/*{{JS}}*/", js)
              .replace("{{DATA}}", data_json))
    return out


def main() -> int:
    out = render()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != out:
            print(f"{OUT.relative_to(ROOT.parent)} が古い。python map/tools/build.py を実行してコミットすること。")
            return 1
        print("生成物は最新")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(f"書き出し: {OUT.relative_to(ROOT.parent)}（{len(out.encode('utf-8')) // 1024} KB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
