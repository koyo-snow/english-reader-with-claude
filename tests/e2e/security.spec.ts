// 仕様書「セキュリティ」と、概要の「本文は読み取り専用」
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/app'
import { CUSTOM_PROMPTS } from './support/prompts'

test.describe('レンダラーの隔離', () => {
  test('SEC-30 レンダラーは contextIsolation: true / nodeIntegration: false / sandbox: true で動く', async ({ launch }) => {
    const app = await launch()
    const prefs = await app.electron.evaluate(({ BrowserWindow }) => {
      // getLastWebPreferences は型定義に載っていないが、実際に適用された webPreferences を返す
      const wc = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences | null }
      const p = wc.getLastWebPreferences()
      return { contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration, sandbox: p?.sandbox, webviewTag: p?.webviewTag }
    })
    expect(prefs).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true })
    expect(prefs.webviewTag).not.toBe(true)
  })

  test('SEC-31 レンダラーから Node の API は使えず、preload が公開した window.api だけが使える', async ({ launch }) => {
    const app = await launch()
    const env = await app.page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      return {
        require: typeof w.require,
        process: typeof w.process,
        module: typeof w.module,
        Buffer: typeof w.Buffer,
        api: Object.keys((w.api ?? {}) as object).sort()
      }
    })
    expect(env).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      Buffer: 'undefined',
      api: ['claude', 'menu', 'settings', 'shell', 'speech', 'state', 'vault']
    })
  })

  test('SEC-32 ページの CSP はスクリプトを自分自身（self）に限定する', async ({ launch }) => {
    const app = await launch()
    const csp = await app.page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toMatch(/script-src 'self'(;|$)/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
    // インラインスクリプトは実行されない
    await app.page.evaluate(() => {
      const s = document.createElement('script')
      s.textContent = 'window.__inline = 1'
      document.body.appendChild(s)
    })
    expect(await app.page.evaluate(() => (window as unknown as { __inline?: number }).__inline)).toBeUndefined()
  })
})

test.describe('サニタイズ', () => {
  test('SEC-33 本文中のスクリプトやイベント属性は実行されず、文字として表示される', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    await expect(app.body).toContainText("<script>window.__xss = 'script'</script>")
    await expect(app.body.locator('script, iframe, img, object, embed')).toHaveCount(0)
    await app.body.locator('a', { hasText: 'bad link' }).click({ timeout: 2000 }).catch(() => {}) // リンクになっていなければ何もしない
    expect(await app.page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined()
    expect(await app.opened()).toEqual([])
  })

  test('SEC-34 Mermaid は securityLevel: strict で描画し、図の中のスクリプトやクリック動作は無効', async ({ launch }) => {
    const md = ['```mermaid', 'graph TD', '  A["<img src=x onerror=\'window.__xss=1\'>Label"] --> B[End]', '  click A call alert("x")', '  click B "javascript:window.__xss=2"', '```', '', 'After the diagram.', ''].join('\n')
    const app = await launch({ vault: { 'Diagram.md': md } })
    await app.open('Diagram.md')
    await expect(app.body.locator('.mermaid-figure svg, .mermaid-error')).toHaveCount(1)
    await expect(app.body).toContainText('After the diagram.')
    await expect(app.body.locator('.mermaid-figure script, .mermaid-figure [onerror], .mermaid-figure [onclick]')).toHaveCount(0)
    await expect(app.body.locator('.mermaid-figure a[href^="javascript:" i], .mermaid-figure a[*|href^="javascript:" i]')).toHaveCount(0)
    for (const node of await app.body.locator('.mermaid-figure .node').all()) await node.click({ force: true }).catch(() => {})
    expect(await app.page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined()
  })
})

test.describe('ファイルアクセスの範囲', () => {
  test('SEC-35 ファイルの読み取りは Vault 配下に限定される', async ({ launch }) => {
    const app = await launch()
    fs.writeFileSync(path.join(app.root, 'secret.md'), 'TOP SECRET')
    const read = (rel: string) =>
      app.page.evaluate(
        (p) =>
          (window as unknown as { api: { vault: { read: (p: string) => Promise<{ body: string }> } } }).api.vault.read(p).then(
            (f) => ({ ok: true, body: f.body }),
            (e: Error) => ({ ok: false, body: String(e.message) })
          ),
        rel
      )
    expect((await read('Short.md')).ok).toBe(true)
    for (const outside of ['../secret.md', path.join(app.root, 'secret.md'), 'Books/../../secret.md', '/etc/hosts']) {
      const res = await read(outside)
      expect(res.ok, outside).toBe(false)
      expect(res.body, outside).not.toContain('TOP SECRET')
    }
  })

  test('SEC-36 本文は読み取り専用：ひととおり操作しても、書き込まれるのは「出力を保存」の保存先フォルダだけ', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    const before = app.vaultSnapshot()

    // 開く・スクロール・検索・ハイライト・設定変更
    await app.open('videos/Talk.md')
    await app.page.getByTitle('タイムスタンプを隠す').click()
    await app.open('Long.md')
    await app.scrollTo(500)
    await app.menu('CmdOrCtrl+F')
    await app.page.locator('.search-bar input').fill('needle')
    await expect(app.page.locator('.search-count')).toHaveText('1 / 4')
    await app.page.locator('.search-bar input').press('Escape')
    await app.open('Short.md')
    await app.select('quick brown fox')
    await app.rightClickSelection()
    await app.contextMenu.getByText('ハイライト', { exact: true }).click()
    await expect.poll(() => app.highlights('user-marks')).toEqual(['quick brown fox'])
    await app.page.getByTitle('表示設定').click()
    await app.slide(app.page.locator('.popover.quick input').first(), 20)
    await app.page.keyboard.press('Escape')

    // 実行・読み上げ・追加質問
    await app.body.locator('p', { hasText: 'A closure is a function' }).click()
    await app.speakButton.click()
    await app.speechState({ speaking: false })
    await app.promptSelect.selectOption({ label: '段落を訳す' })
    await app.runButton.click()
    await app.run(1)
    await app.answer('訳です。')
    await expect(app.bottom.locator('.chat-msg.assistant')).toContainText('訳です。')
    await app.settle()
    expect(app.vaultSnapshot()).toEqual(before) // ここまで Vault には 1 バイトも書いていない

    // 出力を保存
    await app.bottom.getByRole('button', { name: '出力を保存' }).click()
    await expect(app.bottom).toContainText('保存しました')
    await app.quit()

    const after = app.vaultSnapshot()
    const added = Object.keys(after).filter((k) => !(k in before))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatch(/^AI Notes\/Short_AI_\d{8}-\d{4}\.md$/)
    for (const [k, v] of Object.entries(before)) expect(after[k], k).toBe(v)
    // Vault 直下にアプリや Claude Code の作業ファイル（.claude/ など）を作っていない
    expect(fs.readdirSync(app.vaultPath).filter((f) => !(f in { 'AI Notes': 1 }) && !Object.keys(before).some((k) => k.split('/')[0] === f))).toEqual([])
  })

  test('SEC-37 Claude の作業ディレクトリは Vault の外（アプリ専用フォルダ）', async ({ launch }) => {
    const app = await launch({ stubClaude: false, settings: { prompts: CUSTOM_PROMPTS, ai: { claudePath: '/nonexistent/bin/claude' } } })
    const before = app.vaultSnapshot()
    await app.open('Short.md')
    await app.body.locator('p', { hasText: 'A closure is a function' }).click()
    await app.runButton.click()
    await expect(app.bottom.locator('.chat-error')).toBeVisible({ timeout: 30_000 })
    expect(fs.statSync(path.join(app.userData, 'claude-cwd')).isDirectory()).toBe(true)
    expect(app.vaultSnapshot()).toEqual(before)
  })
})

test.describe('外部リンク', () => {
  test('SEC-38 外部に開けるのは http(s) の URL だけ', async ({ launch }) => {
    const app = await launch()
    const open = (url: string) => app.page.evaluate((u) => (window as unknown as { api: { shell: { openExternal: (u: string) => Promise<void> } } }).api.shell.openExternal(u), url)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://server/share', 'x-apple.systempreferences:', 'ftp://example.com', ' https://example.com']) await open(url)
    await open('https://example.com/ok')
    await open('http://example.com/plain')
    expect(await app.opened()).toEqual(['https://example.com/ok', 'http://example.com/plain'])
  })

  test('SEC-39 window.open やページ遷移ではアプリ内ウィンドウを開かず、http(s) は既定のブラウザに渡す', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    const url = app.page.url()
    await app.page.evaluate(() => {
      window.open('https://example.com/popup')
      window.open('file:///etc/passwd')
    })
    await expect.poll(() => app.opened()).toEqual(['https://example.com/popup'])
    expect(app.electron.windows()).toHaveLength(1)

    await app.page.evaluate(() => {
      location.href = 'https://example.com/navigate'
    })
    await expect.poll(() => app.opened()).toEqual(['https://example.com/popup', 'https://example.com/navigate'])
    // 遷移は取り消され、元のページと本文がそのまま残る
    expect(await app.pageState()).toEqual({ url, heading: 'Short Note' })
    expect(app.electron.windows()).toHaveLength(1)
  })
})
