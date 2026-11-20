// E2E の土台。テストごとに一時フォルダ（設定の保存先と Vault）を作り、ビルド済みのアプリを起動する。
//
// 外の世界に出ていく処理はメインプロセス側で差し替える：
//   - Claude の呼び出し（claude:run / claude:stop）… 受け取ったリクエストを記録し、テストから応答イベントを流す
//   - 読み上げ（say）… 実際には鳴らさず、呼び出しを記録する
//   - 外部ブラウザ（shell.openExternal）、フォルダ選択ダイアログ … 記録・固定値を返す
// ClaudeRunner や Speaker 自体の振る舞いは単体テスト（tests/unit/main）で確認する。
import { test as base, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  type AppState,
  type ClaudeErrorKind,
  type ClaudeRunRequest,
  type Settings,
  type SpeechState
} from '../../../src/shared/types'
import { defaultVault } from './vault'

export { expect }

const REPO = path.resolve(__dirname, '../../..')

type DeepPartial<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] }

export interface LaunchOptions {
  /** 既定値に上書きする設定。vaultPath は指定しなければテスト用 Vault になる。 */
  settings?: DeepPartial<Settings>
  state?: Partial<AppState>
  /** settings.json に書く生の文字列（破損したファイルの確認用）。 */
  rawSettings?: string
  /** Vault に置くファイル（相対パス → 内容）。null なら Vault フォルダを作らない。 */
  vault?: Record<string, string> | null
  /** false にすると Claude の呼び出しを差し替えない（実際の ClaudeRunner を通す）。 */
  stubClaude?: boolean
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) out[k] = merge(out[k], v)
  return out as T
}

export class App {
  electron!: ElectronApplication
  page!: Page
  readonly userData: string
  readonly vaultPath: string
  private running = false

  private constructor(
    readonly root: string,
    private readonly stubClaude: boolean
  ) {
    this.userData = path.join(root, 'userData')
    this.vaultPath = path.join(root, 'vault')
  }

  static async create(opts: LaunchOptions = {}): Promise<App> {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'er-e2e-')))
    const app = new App(root, opts.stubClaude !== false)
    fs.mkdirSync(app.userData, { recursive: true })

    const files = opts.vault === undefined ? defaultVault() : opts.vault
    if (files) {
      fs.mkdirSync(app.vaultPath, { recursive: true })
      for (const [rel, content] of Object.entries(files)) app.writeVault(rel, content)
    }

    if (opts.rawSettings !== undefined) {
      fs.writeFileSync(path.join(app.userData, 'settings.json'), opts.rawSettings)
    } else {
      const settings = merge(structuredClone(DEFAULT_SETTINGS), { vaultPath: app.vaultPath, ...opts.settings })
      fs.writeFileSync(path.join(app.userData, 'settings.json'), JSON.stringify(settings, null, 2))
    }
    if (opts.state) {
      fs.writeFileSync(path.join(app.userData, 'state.json'), JSON.stringify({ ...structuredClone(DEFAULT_STATE), ...opts.state }, null, 2))
    }
    await app.start()
    return app
  }

  // ---------- 起動と終了 ----------

  async start(): Promise<void> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL

    this.electron = await electron.launch({ args: [REPO, `--user-data-dir=${this.userData}`], cwd: REPO, env })
    this.running = true

    // 念のため：本物の設定フォルダを触っていないことを確かめる。違っていたら何も書かせずに落とす。
    const actual = await this.electron.evaluate(({ app }) => app.getPath('userData'))
    if (path.resolve(actual) !== path.resolve(this.userData) && fs.realpathSync(actual) !== this.userData) {
      this.electron.process().kill('SIGKILL')
      this.running = false
      throw new Error(`userData がテスト用フォルダになっていません: ${actual}`)
    }

    this.page = await this.electron.firstWindow()
    await this.page.waitForSelector('.app')
    await this.installStubs()
  }

  private async installStubs(): Promise<void> {
    await this.electron.evaluate(({ ipcMain, shell, dialog, BrowserWindow }, stubClaude) => {
      const store = { opened: [] as string[], runs: [] as unknown[], stops: 0, speaks: [] as string[], speechStops: 0, dialogResult: null as string | null }
      ;(globalThis as Record<string, unknown>).__e2e = store
      const send = (channel: string, payload: unknown) => BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)

      shell.openExternal = async (url: string) => {
        store.opened.push(url)
      }
      dialog.showOpenDialog = (async () =>
        store.dialogResult ? { canceled: false, filePaths: [store.dialogResult] } : { canceled: true, filePaths: [] }) as typeof dialog.showOpenDialog

      ipcMain.removeHandler('speech:speak')
      ipcMain.handle('speech:speak', (_e, text: string) => {
        store.speaks.push(text)
        send('speech:state', { speaking: true })
      })
      ipcMain.removeHandler('speech:stop')
      ipcMain.handle('speech:stop', () => {
        store.speechStops++
        send('speech:state', { speaking: false })
      })

      if (stubClaude) {
        ipcMain.removeHandler('claude:run')
        ipcMain.handle('claude:run', (_e, req: unknown) => {
          store.runs.push(req)
        })
        ipcMain.removeHandler('claude:stop')
        ipcMain.handle('claude:stop', () => {
          store.stops++
        })
      }
    }, this.stubClaude)

    // レンダラー側：確認ダイアログとクリップボードは OS に出さずに記録する
    await this.page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      w.__clipboard = [] as string[]
      w.__confirms = [] as string[]
      window.confirm = (message?: string) => {
        ;(w.__confirms as string[]).push(String(message ?? ''))
        return true
      }
      navigator.clipboard.writeText = async (text: string) => {
        ;(w.__clipboard as string[]).push(text)
      }
    })
  }

  /** 通常の終了（終了時の保存処理を通す）。 */
  async quit(): Promise<void> {
    if (!this.running) return
    this.running = false
    const closed = new Promise<void>((resolve) => this.electron.once('close', () => resolve()))
    await this.electron.evaluate(({ app }) => app.quit()).catch(() => {})
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000))
    if ((await Promise.race([closed, timeout])) === 'timeout') this.electron.process().kill('SIGKILL')
  }

  /** 終了して同じ設定フォルダで起動し直す。 */
  async restart(): Promise<void> {
    await this.quit()
    await this.start()
  }

  async dispose(): Promise<void> {
    await this.quit()
    fs.rmSync(this.root, { recursive: true, force: true })
  }

  // ---------- ファイル ----------

  writeVault(rel: string, content: string): void {
    const abs = path.join(this.vaultPath, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }

  /** Vault 配下の全ファイル（隠しファイルも含む）。相対パス → 内容。 */
  vaultSnapshot(): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) walk(abs)
        else out[path.relative(this.vaultPath, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8')
      }
    }
    if (fs.existsSync(this.vaultPath)) walk(this.vaultPath)
    return out
  }

  private readJson<T>(name: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.userData, name), 'utf8')) as T
    } catch {
      return null
    }
  }
  /** ディスク上の settings.json。まだ書かれていなければ null。 */
  settingsOnDisk(): Settings | null {
    return this.readJson<Settings>('settings.json')
  }
  stateOnDisk(): AppState | null {
    return this.readJson<AppState>('state.json')
  }

  // ---------- メインプロセス側 ----------

  private mainStore<T>(key: string): Promise<T> {
    return this.electron.evaluate((_electron, k) => ((globalThis as Record<string, unknown>).__e2e as Record<string, unknown>)[k], key) as Promise<T>
  }

  /** アプリのメニューに登録されたショートカットの項目を実行する（例: 'CmdOrCtrl+L'）。 */
  async menu(accelerator: string): Promise<void> {
    await this.electron.evaluate(({ Menu }, acc) => {
      type Item = Electron.MenuItem
      const find = (items: Item[]): Item | null => {
        for (const i of items) {
          if ((i.accelerator ?? '').toLowerCase() === acc.toLowerCase()) return i
          const sub = i.submenu ? find(i.submenu.items) : null
          if (sub) return sub
        }
        return null
      }
      const item = find(Menu.getApplicationMenu()?.items ?? [])
      if (!item) throw new Error(`メニューに ${acc} がありません`)
      item.click()
    }, accelerator)
  }

  /** メニューの全項目（ラベル・ショートカット・role）。 */
  menuItems(): Promise<{ label: string; accelerator: string; role: string }[]> {
    return this.electron.evaluate(({ Menu }) => {
      type Item = Electron.MenuItem
      const flat = (items: Item[]): Item[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu.items) : [])])
      return flat(Menu.getApplicationMenu()?.items ?? []).map((i) => ({ label: i.label, accelerator: String(i.accelerator ?? ''), role: String(i.role ?? '') }))
    })
  }

  /** 既定のブラウザで開こうとした URL。 */
  opened(): Promise<string[]> {
    return this.mainStore<string[]>('opened')
  }
  /** Claude に送ろうとしたリクエスト。 */
  runs(): Promise<ClaudeRunRequest[]> {
    return this.mainStore<ClaudeRunRequest[]>('runs')
  }
  stops(): Promise<number> {
    return this.mainStore<number>('stops')
  }
  /** 読み上げに渡された文章。 */
  speaks(): Promise<string[]> {
    return this.mainStore<string[]>('speaks')
  }
  speechStops(): Promise<number> {
    return this.mainStore<number>('speechStops')
  }
  async setDialogResult(result: string | null): Promise<void> {
    await this.electron.evaluate((_electron, r) => {
      ;((globalThis as Record<string, unknown>).__e2e as Record<string, unknown>).dialogResult = r
    }, result)
  }

  /** n 件目（1 始まり）のリクエストが届くまで待って返す。 */
  async run(n = 1): Promise<ClaudeRunRequest> {
    await expect.poll(async () => (await this.runs()).length, { message: `Claude への ${n} 件目のリクエスト` }).toBeGreaterThanOrEqual(n)
    return (await this.runs())[n - 1]
  }

  private async send(channel: string, payload: unknown): Promise<void> {
    await this.electron.evaluate(({ BrowserWindow }, [ch, p]) => BrowserWindow.getAllWindows()[0].webContents.send(ch as string, p), [channel, payload] as const)
  }

  /** 最新のリクエストに対する Claude のイベントを流す。 */
  async claude(ev: { type: 'session'; sessionId: string } | { type: 'delta'; text: string } | { type: 'done'; sessionId?: string; costUsd?: number } | { type: 'error'; kind: ClaudeErrorKind; message: string }): Promise<void> {
    const runs = await this.runs()
    const runId = runs[runs.length - 1]?.runId
    if (!runId) throw new Error('まだ実行されていません')
    const payload = ev.type === 'done' ? { sessionId: 'sess-1', costUsd: 0.01, ...ev } : ev
    await this.send('claude:event', { runId, ...payload })
  }

  /** 最新のリクエストに、セッション開始 → 差分 → 完了 の順で応答する。 */
  async answer(text: string, sessionId = 'sess-1'): Promise<void> {
    await this.claude({ type: 'session', sessionId })
    await this.claude({ type: 'delta', text })
    await this.claude({ type: 'done', sessionId })
  }

  async speechState(state: SpeechState): Promise<void> {
    await this.send('speech:state', state)
  }

  windowBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
    return this.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  }
  async setWindowBounds(b: { x: number; y: number; width: number; height: number }): Promise<void> {
    await this.electron.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), b)
  }

  // ---------- 画面 ----------

  get left(): Locator {
    return this.page.locator('.drawer-left')
  }
  get right(): Locator {
    return this.page.locator('.drawer-right')
  }
  get bottom(): Locator {
    return this.page.locator('.drawer-bottom')
  }
  get body(): Locator {
    return this.page.locator('.reader-body')
  }
  get scroller(): Locator {
    return this.page.locator('.reader-scroll')
  }
  get contextMenu(): Locator {
    return this.page.locator('.context-menu')
  }
  /** 右ドロワーの入力単位ボタン。 */
  unit(label: '選択範囲' | '段落' | 'ファイル全体'): Locator {
    return this.right.locator('.segmented button', { hasText: label })
  }
  get promptSelect(): Locator {
    return this.right.locator('select')
  }
  get runButton(): Locator {
    return this.right.locator('.run-row button', { hasText: '実行' })
  }
  get speakButton(): Locator {
    return this.right.locator('.run-row button', { hasText: '読み上げ' })
  }
  get preview(): Locator {
    return this.right.locator('.preview')
  }
  /** ツリーの行（フォルダ・ファイル）を Vault からの相対パスで指す。 */
  treeRow(rel: string): Locator {
    return this.left.locator(`.tree-row[title="${rel}"]`)
  }
  /** ツリーに見えている行の名前（上から順）。 */
  treeNames(): Promise<string[]> {
    return this.left.locator('.tree-row .tree-name').allTextContents()
  }

  /** ツリーからファイルを開く（必要なら親フォルダを開く）。 */
  async open(rel: string): Promise<void> {
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      const next = parts.slice(0, i + 1).join('/')
      if ((await this.treeRow(next).count()) === 0) await this.treeRow(folder).click()
    }
    await this.treeRow(rel).click()
    await expect(this.treeRow(rel)).toHaveClass(/active/)
    await expect(this.body).toBeVisible()
  }

  /** 本文中の文字列を選択する（マウスでなぞったのと同じ状態にする）。 */
  async select(text: string): Promise<void> {
    const ok = await this.body.evaluate((root, needle) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const idx = (node as Text).data.indexOf(needle)
        if (idx === -1) continue
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + needle.length)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return true
      }
      return false
    }, text)
    if (!ok) throw new Error(`本文に「${text}」が見つかりません`)
  }

  /** 選択中の文字列の上で右クリックする。 */
  async rightClickSelection(): Promise<void> {
    const pos = await this.page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
      const rect = sel.getRangeAt(0).getClientRects()[0]
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    if (!pos) throw new Error('何も選択されていません')
    await this.page.mouse.click(pos.x, pos.y, { button: 'right' })
    await expect(this.contextMenu).toBeVisible()
  }

  /** 右クリックメニューの項目名（上から順。右端の「段落」「選択範囲」の表示は除く）。 */
  async contextMenuItems(): Promise<string[]> {
    const items = await this.contextMenu.locator('.menu-item').evaluateAll((els) =>
      els.map((el) => Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
    )
    return items
  }

  /** range 型の入力（スライダー）を動かす。 */
  async slide(slider: Locator, value: number): Promise<void> {
    await slider.evaluate((el, v) => {
      const input = el as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, String(v))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
  }

  /** CSS Custom Highlight API に登録された範囲の文字列。 */
  highlights(name: 'search' | 'search-current' | 'user-marks'): Promise<string[]> {
    return this.page.evaluate((n) => {
      const registry = (CSS as unknown as { highlights: Map<string, Iterable<Range>> }).highlights
      const h = registry.get(n)
      return h ? Array.from(h).map((r) => r.toString()) : []
    }, name)
  }

  clipboard(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as { __clipboard: string[] }).__clipboard)
  }
  confirms(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as { __confirms: string[] }).__confirms)
  }

  /** 遅延して送られる保存（スクロール位置など）がメインプロセスに届くのを待つ。 */
  async settle(): Promise<void> {
    await this.page.waitForTimeout(700)
  }

  /** メインプロセスから見た、ページの現在の URL と本文の先頭の見出し（ページ遷移の確認用）。 */
  pageState(): Promise<{ url: string; heading: string | null }> {
    return this.electron.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      const heading = (await wc.executeJavaScript('document.querySelector(".reader-body h1")?.textContent ?? null')) as string | null
      return { url: wc.getURL(), heading }
    })
  }

  async scrollTo(top: number): Promise<void> {
    await this.scroller.evaluate((el, t) => {
      el.scrollTop = t
    }, top)
  }
  scrollTop(): Promise<number> {
    return this.scroller.evaluate((el) => el.scrollTop)
  }

  /** 設定タブを開く（Cmd+,）。 */
  async openSettings(): Promise<Locator> {
    await this.menu('CmdOrCtrl+,')
    const tab = this.page.locator('.settings')
    await expect(tab).toBeVisible()
    return tab
  }
  /** 設定タブの行（ラベルで指定）の入力欄など。 */
  settingRow(label: string): Locator {
    return this.page.locator('.settings-row', { has: this.page.locator('.settings-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
  }
}

export const test = base.extend<{ launch: (opts?: LaunchOptions) => Promise<App> }>({
  launch: async ({}, use, testInfo) => {
    const apps: App[] = []
    await use(async (opts) => {
      const app = await App.create(opts)
      apps.push(app)
      return app
    })
    for (const app of apps) {
      if (testInfo.status !== testInfo.expectedStatus) {
        const shot = testInfo.outputPath(`failure-${apps.indexOf(app)}.png`)
        await app.page
          .screenshot({ path: shot })
          .then(() => testInfo.attach('screenshot', { path: shot, contentType: 'image/png' }))
          .catch(() => {})
      }
      await app.dispose()
    }
  }
})
