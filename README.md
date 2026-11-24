# my-RISS-study

情報処理安全確保支援士試験（SC）の学習ノートサイト「セキスペ合格ノート」。

- 公開サイト：https://popo-fukuro.github.io/my-RISS-study/
- 質問するたびに、図解付きの解説ページを `docs/` に追加していく。
- 作業ルールは [CLAUDE.md](CLAUDE.md)、ノートのひな形は [templates/note-template.md](templates/note-template.md)。

## 仕組み

- [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) で Markdown からサイトを生成する。
- `main` に push すると、GitHub Actions（`.github/workflows/deploy.yml`）が GitHub Pages に自動公開する。

## ローカルで確認する

```bash
pip install -r requirements.txt
mkdocs serve
```
