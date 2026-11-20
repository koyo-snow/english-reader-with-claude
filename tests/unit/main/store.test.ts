// 仕様書「設定JSON」：settings.json / state.json の読み書き、破損時の退避、項目の補完
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_STATE, type Settings } from '@shared/types'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }))

import { flushStores, initStores, settingsStore, stateStore } from '../../../src/main/store'

const file = (name: string) => path.join(h.userData, name)
const readJson = (name: string) => JSON.parse(fs.readFileSync(file(name), 'utf8'))

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'er-store-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  fs.rmSync(h.userData, { recursive: true, force: true })
})

describe('設定ファイルの読み込み', () => {
  it('JSON-10 ファイルがなければ既定値で起動する', () => {
    initStores()
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(stateStore.get()).toEqual(DEFAULT_STATE)
  })

  it('JSON-11 保存済みの値を読み込む（前回の Vault を開くため）', () => {
    const saved: Settings = { ...structuredClone(DEFAULT_SETTINGS), vaultPath: '/Users/you/Obsidian/MyVault', theme: 'dark' }
    fs.writeFileSync(file('settings.json'), JSON.stringify(saved))
    fs.writeFileSync(
      file('state.json'),
      JSON.stringify({ version: 1, scroll: { 'a.md': 120 }, highlights: { 'a.md': ['event loop'] }, treeOpen: ['Books'], lastFile: 'a.md', window: null })
    )
    initStores()
    expect(settingsStore.get().vaultPath).toBe('/Users/you/Obsidian/MyVault')
    expect(settingsStore.get().theme).toBe('dark')
    expect(stateStore.get()).toMatchObject({ scroll: { 'a.md': 120 }, highlights: { 'a.md': ['event loop'] }, treeOpen: ['Books'], lastFile: 'a.md' })
  })

  it('JSON-12 settings.json が壊れていれば settings.broken.json に退避し、既定値で起動する', () => {
    const broken = '{ "vaultPath": "/x", "theme": '
    fs.writeFileSync(file('settings.json'), broken)
    initStores()
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(fs.readFileSync(file('settings.broken.json'), 'utf8')).toBe(broken)
  })

  it('JSON-13 state.json が壊れていても既定値で起動する（state.broken.json に退避）', () => {
    fs.writeFileSync(file('state.json'), 'not json at all')
    initStores()
    expect(stateStore.get()).toEqual(DEFAULT_STATE)
    expect(fs.readFileSync(file('state.broken.json'), 'utf8')).toBe('not json at all')
  })

  it('JSON-14 欠けている項目は既定値で補う（将来の項目追加に備えた移行）', () => {
    fs.writeFileSync(file('settings.json'), JSON.stringify({ version: 1, vaultPath: '/v', reader: { fontSize: 20 }, layout: { left: { open: false } } }))
    initStores()
    const s = settingsStore.get()
    expect(s.vaultPath).toBe('/v')
    expect(s.reader.fontSize).toBe(20)
    expect(s.reader.lineHeight).toBe(DEFAULT_SETTINGS.reader.lineHeight)
    expect(s.reader.videoUrlKeys).toEqual(['url', 'source'])
    expect(s.layout.left).toEqual({ open: false, width: 260 })
    expect(s.layout.right).toEqual(DEFAULT_SETTINGS.layout.right)
    expect(s.ai).toEqual(DEFAULT_SETTINGS.ai)
    expect(s.save).toEqual(DEFAULT_SETTINGS.save)
    expect(s.prompts).toEqual(DEFAULT_SETTINGS.prompts)
    expect(s.version).toBe(1)
  })

  it('JSON-15 prompts は配列の順番のまま読み込む', () => {
    const prompts = [
      { id: 'z', name: 'Z', body: 'z', defaultInput: 'wholeFile', model: 'opus', showInContextMenu: false },
      { id: 'a', name: 'A', body: 'a', defaultInput: 'paragraph', model: null, showInContextMenu: true },
      { id: 'm', name: 'M', body: 'm', defaultInput: 'selection', model: 'haiku', showInContextMenu: true }
    ]
    fs.writeFileSync(file('settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, prompts }))
    initStores()
    expect(settingsStore.get().prompts).toEqual(prompts)
  })

  it('JSON-16 defaultInput は selection／paragraph／wholeFile のいずれか。不正な値は直す', () => {
    const prompts = [
      { id: 'a', name: 'A', body: 'a', defaultInput: 'everything', model: 'gpt', showInContextMenu: true },
      { id: 'b', name: 'B' }
    ]
    fs.writeFileSync(file('settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, prompts }))
    initStores()
    const loaded = settingsStore.get().prompts
    expect(loaded).toHaveLength(2)
    for (const p of loaded) {
      expect(['selection', 'paragraph', 'wholeFile']).toContain(p.defaultInput)
      expect([null, 'sonnet', 'opus', 'haiku']).toContain(p.model)
      expect(typeof p.body).toBe('string')
      expect(typeof p.showInContextMenu).toBe('boolean')
    }
  })

  it('SP-22 保存された読み上げ速度が範囲外なら 0.3〜3.0 に収める', () => {
    fs.writeFileSync(file('settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, speech: { rate: 10 } }))
    initStores()
    expect(settingsStore.get().speech.rate).toBe(3)
  })
})

describe('設定ファイルの書き込み', () => {
  it('JSON-20 設定は settings.json、読書位置などは state.json に分けて保存する', () => {
    initStores()
    settingsStore.set({ ...settingsStore.get(), vaultPath: '/my/vault' })
    stateStore.set({ ...stateStore.get(), scroll: { 'a.md': 300 }, lastFile: 'a.md' })
    flushStores()
    expect(readJson('settings.json').vaultPath).toBe('/my/vault')
    expect(readJson('settings.json')).not.toHaveProperty('scroll')
    expect(readJson('state.json')).toMatchObject({ scroll: { 'a.md': 300 }, lastFile: 'a.md' })
    expect(readJson('state.json')).not.toHaveProperty('vaultPath')
  })

  it('JSON-21 変更は少し待って自動保存される（保存ボタンなし）', () => {
    vi.useFakeTimers()
    initStores()
    settingsStore.set({ ...settingsStore.get(), theme: 'dark' })
    expect(settingsStore.get().theme).toBe('dark') // メモリ上は即時反映
    expect(fs.existsSync(file('settings.json'))).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(readJson('settings.json').theme).toBe('dark')
  })

  it('JSON-22 保存した設定は次回起動時にそのまま復元される', () => {
    initStores()
    const next: Settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      vaultPath: '/my/vault',
      layout: { left: { open: false, width: 300 }, right: { open: true, width: 400 }, bottom: { open: true, height: 350 } }
    }
    settingsStore.set(next)
    stateStore.set({ ...stateStore.get(), treeOpen: ['Books'], window: { x: 10, y: 20, width: 900, height: 700 } })
    flushStores()
    initStores() // 再起動に相当
    expect(settingsStore.get()).toEqual(next)
    expect(stateStore.get().treeOpen).toEqual(['Books'])
    expect(stateStore.get().window).toEqual({ x: 10, y: 20, width: 900, height: 700 })
  })

  it('JSON-23 書き込み途中の一時ファイルを残さない', () => {
    initStores()
    settingsStore.set({ ...settingsStore.get(), theme: 'light' })
    flushStores()
    expect(fs.readdirSync(h.userData).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('JSON-24 version は 1 で保存される', () => {
    initStores()
    flushStores()
    expect(readJson('settings.json').version).toBe(1)
    expect(readJson('state.json').version).toBe(1)
  })
})
