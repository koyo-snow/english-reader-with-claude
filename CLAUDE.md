# English Reader

Obsidian Vault の英語文書を Claude の解説付きで読む macOS 専用 Electron アプリ。仕様の正本は `英語読書アシスタント（Electron）仕様書.md`、構成の概要は `README.md`。

## コマンド

- `npm run dev` 開発起動 / `npm run typecheck` 型チェック / `npm run build` → `dist/mac-arm64/English Reader.app`
- `npx electron-vite build` だけなら `out/` に出力され、`npx electron .` で起動できる

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
