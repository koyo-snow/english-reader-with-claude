// アプリメニュー。ショートカットはすべてローカル（メニュー登録）で、Cmd+R は右ドロワーに割り当てる。
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/types'

export function buildMenu(getWindow: () => BrowserWindow | null, send: (cmd: MenuCommand) => void): void {
  const cmd = (label: string, accelerator: string, command: MenuCommand): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(command)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        cmd('設定…', 'CmdOrCtrl+,', 'settings'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'ファイル',
      submenu: [
        cmd('Vault を開く…', 'CmdOrCtrl+Shift+O', 'open-vault'),
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        cmd('ファイル内検索', 'CmdOrCtrl+F', 'find')
      ]
    },
    {
      label: '表示',
      submenu: [
        cmd('左ドロワー（ファイル）', 'CmdOrCtrl+L', 'toggle-left'),
        cmd('右ドロワー（AI 入力）', 'CmdOrCtrl+R', 'toggle-right'),
        cmd('下ドロワー（AI 出力）', 'CmdOrCtrl+D', 'toggle-bottom'),
        { type: 'separator' },
        cmd('設定', 'CmdOrCtrl+,', 'settings'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              {
                label: '開発用: 再読み込み',
                accelerator: 'CmdOrCtrl+Shift+Alt+R',
                click: () => getWindow()?.webContents.reload()
              },
              { role: 'toggleDevTools', accelerator: 'Alt+CmdOrCtrl+I' }
            ] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'AI',
      submenu: [cmd('プロンプトを実行', 'CmdOrCtrl+Enter', 'run')]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
