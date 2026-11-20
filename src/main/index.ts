import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { flushStores, initStores, settingsStore, stateStore } from './store'
import { readVaultFile, saveOutput, scanTree, VaultWatcher } from './vault'
import { ClaudeRunner, resolveClaude } from './claude'
import { buildMenu } from './menu'
import { Speaker } from './speech'
import type { AppState, ClaudeRunRequest, MenuCommand, SaveOutputRequest, Settings } from '@shared/types'

let win: BrowserWindow | null = null
let watcher: VaultWatcher
let runner: ClaudeRunner
let speaker: Speaker

function sendToRenderer(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
}

// 開発起動時 (npm run dev / npx electron .) は .app のバンドルがないので Dock に Electron 標準アイコンが出る。
// build/icon.png があればそれを Dock に表示する。パッケージ版は electron-builder が .icns を埋め込む。
function applyDevDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin') return
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png')
  if (fs.existsSync(iconPath)) app.dock?.setIcon(iconPath)
}

function restoreBounds(): Electron.Rectangle {
  const saved = stateStore.get().window
  const fallback = { width: 1280, height: 860 }
  if (!saved) return { x: undefined as unknown as number, y: undefined as unknown as number, ...fallback }
  const onScreen = screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return saved.x >= b.x - 50 && saved.y >= b.y - 50 && saved.x < b.x + b.width && saved.y < b.y + b.height
  })
  return onScreen ? saved : { x: undefined as unknown as number, y: undefined as unknown as number, ...fallback }
}

function createWindow(): void {
  const bounds = restoreBounds()
  win = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win?.show())

  let boundsTimer: NodeJS.Timeout | null = null
  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isFullScreen()) return
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return
      const b = win.getNormalBounds()
      stateStore.set({ ...stateStore.get(), window: { x: b.x, y: b.y, width: b.width, height: b.height } })
    }, 300)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost')) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  // 設定
  ipcMain.handle('settings:get', () => settingsStore.get())
  ipcMain.handle('settings:set', async (_e, next: Settings) => {
    const prev = settingsStore.get()
    settingsStore.set(next)
    if (prev.theme !== next.theme) applyTheme(next.theme)
    if (prev.speech.rate !== next.speech.rate) speaker.setRate(next.speech.rate)
    if (prev.vaultPath !== next.vaultPath) {
      await watcher.start(next.vaultPath)
      sendToRenderer('vault:tree', scanTree(next.vaultPath))
    }
    return next
  })
  ipcMain.handle('settings:chooseFolder', async () => {
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Obsidian Vault を選択'
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('settings:chooseFile', async () => {
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'showHiddenFiles'],
      title: 'claude 実行ファイルを選択'
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // 状態
  ipcMain.handle('state:get', () => stateStore.get())
  ipcMain.handle('state:patch', (_e, patch: Partial<AppState>) => {
    const next = { ...stateStore.get(), ...patch, window: stateStore.get().window }
    stateStore.set(next)
    return next
  })

  // Vault
  ipcMain.handle('vault:tree', () => scanTree(settingsStore.get().vaultPath))
  ipcMain.handle('vault:exists', () => {
    const p = settingsStore.get().vaultPath
    return Boolean(p) && fs.existsSync(p) && fs.statSync(p).isDirectory()
  })
  ipcMain.handle('vault:read', (_e, rel: string) => readVaultFile(settingsStore.get().vaultPath, rel))
  ipcMain.handle('vault:saveOutput', (_e, req: SaveOutputRequest) => {
    const s = settingsStore.get()
    return saveOutput(s.vaultPath, s.save.folder, req)
  })

  // Claude
  ipcMain.handle('claude:run', (_e, req: ClaudeRunRequest) => {
    void runner.run(req, settingsStore.get())
  })
  ipcMain.handle('claude:stop', () => runner.stop())
  ipcMain.handle('claude:info', () => resolveClaude(settingsStore.get()))

  // 読み上げ（say コマンド）
  ipcMain.handle('speech:speak', (_e, text: string) => speaker.speak(typeof text === 'string' ? text : ''))
  ipcMain.handle('speech:stop', () => speaker.stop())

  // その他
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
    return undefined
  })
}

app.whenReady().then(async () => {
  initStores()
  applyTheme(settingsStore.get().theme)
  applyDevDockIcon()

  watcher = new VaultWatcher(
    (change) => sendToRenderer('vault:change', change),
    () => sendToRenderer('vault:tree', scanTree(settingsStore.get().vaultPath))
  )
  runner = new ClaudeRunner((ev) => sendToRenderer('claude:event', ev))
  speaker = new Speaker((state) => sendToRenderer('speech:state', state), settingsStore.get().speech.rate)

  registerIpc()
  buildMenu(
    () => win,
    (cmd: MenuCommand) => sendToRenderer('menu:command', cmd)
  )
  createWindow()
  await watcher.start(settingsStore.get().vaultPath)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  runner?.stop()
  speaker?.stop()
  flushStores()
})
