import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

// 単体テスト。メインプロセス側は node、レンダラー側は jsdom で動かす。
// 画面を通す確認は Playwright（tests/e2e）で行う。
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'main',
          environment: 'node',
          include: ['tests/unit/main/**/*.test.ts', 'tests/unit/shared/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.ts']
        }
      }
    ]
  }
})
