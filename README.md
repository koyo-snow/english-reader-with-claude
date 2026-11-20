# English Reader

Obsidian Vault に保存した英語の字幕・技術文書を読み、選択範囲や段落を Claude に解説させる macOS 専用の Electron アプリ。仕様は `英語読書アシスタント（Electron）仕様書.md` を参照。

## 前提

- Node.js 20 以上
- Claude Code CLI がインストール済みで、ターミナルで `claude` にログイン済みであること（API キーは使わない）

## 開発

```bash
npm install
npm run dev        # 開発モードで起動（ホットリロード）
npm run typecheck  # 型チェック
npm run build      # dist/mac-arm64/English Reader.app を作る（署名・公証なし）
```

初回起動後、設定タブ（Cmd+,）で Vault のパスを指定する。

アプリアイコンは `build/icon.png`（正方形、1024x1024 推奨・最低 512x512）を置く。`npm run build` で `.icns` に変換されて `.app` に埋め込まれ、`npm run dev` でも Dock に表示される。ファイルがなければ Electron 標準のアイコンになる。

## 構成

```
src/
  shared/types.ts       設定・状態・IPC の型と既定値（初期プロンプトもここ）
  main/
    index.ts            ウィンドウ、IPC ハンドラ、起動処理
    store.ts            settings.json / state.json の読み書き
    vault.ts            ツリー走査・ファイル読み取り・監視・出力の保存
    claude.ts           Claude Agent SDK 経由の呼び出し（ツール無効、ストリーミング）
    speech.ts           macOS の say コマンドで入力単位の文章を読み上げる
    menu.ts             アプリメニューとローカルショートカット
  preload/index.ts      contextBridge で公開する window.api
  renderer/src/
    App.tsx             レイアウトと全体の状態
    markdown.ts         markdown-it + Shiki + タイムスタンプ記法 + DOMPurify
    MarkdownView.tsx    HTML 描画と Mermaid
    textRanges.ts       検索・マーカー用の Range 検索（CSS Custom Highlight API）
    components/         Drawer, FileTree, Reader, RightDrawer, BottomDrawer, SettingsTab
```

設定は `~/Library/Application Support/English Reader/settings.json`、読書位置などは同じ場所の `state.json` に保存される。Claude の作業ディレクトリは同じ場所の `claude-cwd/`（空フォルダ）。

## ショートカット

| キー | 動作 |
| --- | --- |
| Cmd+L / Cmd+R / Cmd+D | 左 / 右 / 下ドロワーの開閉 |
| Cmd+F | ファイル内検索 |
| Cmd+, | 設定タブ |
| Cmd+Enter | 右ドロワーのプロンプトを実行 |
| Cmd+Shift+Alt+R | （開発時のみ）再読み込み |
