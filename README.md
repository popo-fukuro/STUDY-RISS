# STUDY-RISS

情報処理安全確保支援士試験（SC）の学習ノートサイト「セキスペ合格ノート」。

- 公開サイト：https://popo-fukuro.github.io/STUDY-RISS/
- 質問するたびに、図解付きの解説ページを `docs/` に追加していく。
- 作業ルールは [CLAUDE.md](CLAUDE.md)、ノートのひな形は [templates/note-template.md](templates/note-template.md)。

## 試験範囲マップ

- 公開URL：https://popo-fukuro.github.io/STUDY-RISS/map/
- 試験範囲を16分野・中分類・用語の4階層と、分野間の関係で示す単体のHTML（素の HTML/CSS/JavaScript と SVG）。
- データは `map/data/`、画面の部品は `map/src/`、生成と検査の道具は `map/tools/`、調査メモは `map/research/`。
- 更新手順は [CLAUDE.md](CLAUDE.md) の「試験範囲マップ」を参照。

## 仕組み

- [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) で Markdown からサイトを生成する。
- `main` に push すると、GitHub Actions（`.github/workflows/deploy.yml`）が GitHub Pages に自動公開する。

## ローカルで確認する

```bash
pip install -r requirements.txt
mkdocs serve
```
