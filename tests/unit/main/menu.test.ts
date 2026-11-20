// 仕様書「ショートカット」「実装上の注意：Cmd+R の競合」
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuCommand } from '@shared/types'

interface Item {
  label?: string
  role?: string
  accelerator?: string
  click?: () => void
  submenu?: Item[]
}

const h = vi.hoisted(() => ({ template: [] as any[], isPackaged: false, setApplicationMenu: null as any }))

vi.mock('electron', () => ({
  app: {
    name: 'English Reader',
    get isPackaged() {
      return h.isPackaged
    }
  },
  Menu: {
    buildFromTemplate: (t: unknown[]) => {
      h.template = t
      return { built: t }
    },
    setApplicationMenu: (m: unknown) => h.setApplicationMenu(m)
  }
}))

import { buildMenu } from '../../../src/main/menu'

const flat = (items: Item[]): Item[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu) : [])])
let sent: MenuCommand[]
const reload = vi.fn()

function build(): Item[] {
  buildMenu(
    () => ({ webContents: { reload } }) as never,
    (cmd) => sent.push(cmd)
  )
  return flat(h.template as Item[])
}

beforeEach(() => {
  sent = []
  reload.mockClear()
  h.isPackaged = false
  h.setApplicationMenu = vi.fn()
})

describe('ショートカット', () => {
  it.each([
    ['Cmd+L', 'CmdOrCtrl+L', 'toggle-left'],
    ['Cmd+R', 'CmdOrCtrl+R', 'toggle-right'],
    ['Cmd+D', 'CmdOrCtrl+D', 'toggle-bottom'],
    ['Cmd+F', 'CmdOrCtrl+F', 'find'],
    ['Cmd+,', 'CmdOrCtrl+,', 'settings'],
    ['Cmd+Enter', 'CmdOrCtrl+Enter', 'run']
  ] as const)('KEY-01 %s がアプリのメニューに登録され、対応する動作を呼ぶ', (_key, accelerator, command) => {
    const items = build().filter((i) => i.accelerator === accelerator)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      sent = []
      item.click?.()
      expect(sent).toEqual([command])
    }
  })

  it('KEY-02 メニューをアプリケーションメニューとして設定する', () => {
    build()
    expect(h.setApplicationMenu).toHaveBeenCalledTimes(1)
  })

  it('KEY-03 グローバルショートカットは使わない', () => {
    const dir = path.resolve(__dirname, '../../../src/main')
    for (const f of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/globalShortcut/)
    }
  })

  it('KEY-04 1 つのキーに複数の動作を割り当てない', () => {
    const byKey = new Map<string, Set<string>>()
    for (const item of build()) {
      if (!item.accelerator) continue
      const key = item.accelerator.toLowerCase()
      sent = []
      item.click?.()
      const action = sent[0] ?? item.role ?? item.label ?? ''
      byKey.set(key, (byKey.get(key) ?? new Set()).add(action))
    }
    for (const [key, actions] of byKey) expect([...actions], key).toHaveLength(1)
  })
})

describe('Cmd+R の競合', () => {
  it('IMPL-01 既定の View メニュー（再読み込み）を使わず、Cmd+R は右ドロワーだけに割り当てる', () => {
    const items = build()
    const roles = items.map((i) => (i.role ?? '').toLowerCase())
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forcereload')
    expect(roles).not.toContain('viewmenu')
    const cmdR = items.filter((i) => i.accelerator?.toLowerCase() === 'cmdorctrl+r')
    expect(cmdR).toHaveLength(1)
    cmdR[0].click?.()
    expect(sent).toEqual(['toggle-right'])
    expect(reload).not.toHaveBeenCalled()
  })

  it('IMPL-02 開発中の再読み込みは別のキーに割り当てる', () => {
    const dev = build().find((i) => i.label?.includes('再読み込み'))
    expect(dev).toBeDefined()
    expect(dev?.accelerator?.toLowerCase()).not.toBe('cmdorctrl+r')
    dev?.click?.()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([])
  })

  it('IMPL-03 パッケージ版には再読み込みと開発者ツールの項目を出さない', () => {
    h.isPackaged = true
    const items = build()
    expect(items.find((i) => i.label?.includes('再読み込み'))).toBeUndefined()
    expect(items.map((i) => (i.role ?? '').toLowerCase())).not.toContain('toggledevtools')
  })
})
