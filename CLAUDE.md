# English Reader

Obsidian Vault の英語文書を Claude の解説付きで読む macOS 専用 Electron アプリ。仕様の正本は `英語読書アシスタント（Electron）仕様書.md`、構成の概要は `README.md`。

## コマンド

- `npm run dev` 開発起動 / `npm run typecheck` 型チェック / `npm run build` → `dist/mac-arm64/English Reader.app`
- `npx electron-vite build` だけなら `out/` に出力され、`npx electron .` で起動できる
- `npm test` 単体テスト（Vitest、`tests/unit/`） / `npm run test:e2e` ビルド + E2E（Playwright、`tests/e2e/`） / `npm run test:all` 型チェックも含めて全部
- CI（`.github/workflows/ci.yml`）は型チェックと単体テストだけ。E2E は CI に組み込まず、ローカルで実行する。

## 設計上の約束

- 本文は読み取り専用。Vault への書き込みは `main/vault.ts` の `saveOutput` のみ（保存先フォルダ配下、新規ファイルのみ）。
- Claude は `@anthropic-ai/claude-agent-sdk` の `query()` をメインプロセスで呼ぶ。`tools: []` で全ツール無効、`settingSources: []`、`systemPrompt` は文字列。追加質問は `resume: sessionId`。API キーは渡さない（env から削除）。
- レンダラーは sandbox / contextIsolation。Node は preload 経由の `window.api` だけ。CSP は `script-src 'self'` のみなので Shiki は JS 正規表現エンジン（wasm 不可）。
- Markdown の HTML は DOMPurify を通す。Mermaid のソースは `<pre class="mermaid-block"><code>` の中身から読む（`data-*` 属性は `-->` を含むと DOMPurify に落とされる）。
- タイムスタンプは `markdown.ts` の core ルールで text トークンを分割して `<a class="ts" data-s>` にする。行頭の数字は inline ルールでは拾えない。
- 検索・マーカーは CSS Custom Highlight API（`textRanges.ts`）。DOM は書き換えない。
- 型とデフォルト（初期プロンプト含む）は `src/shared/types.ts` に集約。

## 動作確認のやり方

起動時に `--remote-debugging-port=9333` を付けると、`node scripts/cdp.mjs eval '<js>'` / `shot <png>` / `console` でレンダラーを操作・撮影できる（`window.api` も呼べる）。メニューのショートカットは CDP のキー入力では発火しないので、`osascript` で `process "Electron"` のメニュー項目をクリックする。

## テストの約束

- テストの題名は仕様書の文をそのまま書き、先頭に ID（`TREE-04` など）を付ける。章と ID の対応、手動で確かめる項目は `docs/テストケース.md`。
- 仕様を満たしていないと分かった項目は、テストを消したり実装に合わせて緩めたりせず、`it.fails` / `test.fail()` を付けて原因をコメントに書く。直したら印を外す。
- E2E は `tests/e2e/support/app.ts` の `launch()` で起動する。`--user-data-dir` で一時フォルダを使い、Claude・`say`・`shell.openExternal`・ダイアログはメインプロセス側で差し替える。メニューのショートカットは `app.menu('CmdOrCtrl+L')` で項目を直接実行する。
- 起動中に `state.json` をディスクから読んで確かめない（終了時にしか書き出されない。`docs/テストケース.md` の JSON-32）。`app.settle()` → `app.quit()` / `app.restart()` の後で読む。
