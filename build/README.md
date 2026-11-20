# build/

electron-builder の `buildResources`。ここに `icon.png`（1024x1024 推奨、最低 512x512、正方形）を置くとアプリアイコンになる。

- `npm run build`: `.icns` に自動変換されて `English Reader.app` に埋め込まれる
- `npm run dev`: 起動時に Dock アイコンとして読み込まれる（`src/main/index.ts` の `applyDevDockIcon`）
