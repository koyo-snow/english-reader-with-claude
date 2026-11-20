import { defineConfig } from '@playwright/test'

// E2E：ビルド済みのアプリ（out/）を Electron で起動して画面を操作する。
// 先に `npx electron-vite build` が必要（`npm run test:e2e` がまとめて行う）。
// CI には組み込まず、ローカルで実行する。
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // ウィンドウのフォーカスに依存する操作（選択、ポップオーバー）があるので 1 つずつ動かす
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure'
  }
})
