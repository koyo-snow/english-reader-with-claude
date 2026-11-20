// 仕様書「右ドロワー：入力単位」の表（送る内容／使えない条件）
import { describe, expect, it } from 'vitest'
import { unitAvailability } from '../../../src/renderer/src/components/RightDrawer'
import type { FileContent } from '@shared/types'

function file(body: string, patch: Partial<FileContent> = {}): FileContent {
  return { path: 'docs/Talk.md', name: 'Talk.md', body, frontmatter: { title: 'Talk' }, charCount: body.length, mtimeMs: 0, ...patch }
}
const LIMIT = 1000

describe('選択範囲', () => {
  it('IN-01 本文で選択中のテキストを送る', () => {
    expect(unitAvailability('selection', 'event loop', 'The whole paragraph.', file('x'), LIMIT)).toMatchObject({ ok: true, text: 'event loop' })
  })

  it('IN-02 何も選択していなければ、最後にクリックした段落を送る', () => {
    const a = unitAvailability('selection', '', 'The whole paragraph.', file('x'), LIMIT)
    expect(a).toMatchObject({ ok: true, text: 'The whole paragraph.' })
    expect(a.note).toBeTruthy() // 段落を送ることを知らせる
  })

  it('IN-03 何も選択しておらず、段落も指定していなければ使えない（理由を示す）', () => {
    const a = unitAvailability('selection', '', '', file('x'), LIMIT)
    expect(a.ok).toBe(false)
    expect(a.text).toBe('')
    expect(a.reason.length).toBeGreaterThan(0)
  })
})

describe('段落', () => {
  it('IN-04 最後にクリックした段落を送る（選択中のテキストがあっても段落）', () => {
    expect(unitAvailability('paragraph', 'event loop', 'The whole paragraph.', file('x'), LIMIT)).toMatchObject({ ok: true, text: 'The whole paragraph.' })
  })

  it('IN-05 段落を指定していなければ使えない（理由を示す）', () => {
    const a = unitAvailability('paragraph', 'event loop', '', file('x'), LIMIT)
    expect(a.ok).toBe(false)
    expect(a.reason.length).toBeGreaterThan(0)
  })
})

describe('ファイル全体', () => {
  it('IN-06 表示中ファイルの本文（frontmatter を除く）を送る', () => {
    const a = unitAvailability('wholeFile', 'sel', 'para', file('# Talk\n\nHello world.\n'), LIMIT)
    expect(a).toMatchObject({ ok: true, text: '# Talk\n\nHello world.' })
    expect(a.text).not.toContain('title:')
  })

  it('IN-07 本文がちょうど上限（1000 文字）なら使える', () => {
    expect(unitAvailability('wholeFile', '', '', file('a'.repeat(1000)), LIMIT).ok).toBe(true)
  })

  it('IN-08 本文が上限を超えると使えず、理由に上限と実際の文字数を示す', () => {
    const a = unitAvailability('wholeFile', '', '', file('a'.repeat(3842)), LIMIT)
    expect(a.ok).toBe(false)
    expect(a.text).toBe('')
    // 仕様書の例：「本文が1000文字を超えるため使えません（3,842文字）」
    expect(a.reason).toMatch(/^本文が1,?000文字を超えるため使えません（3,842文字）$/)
  })

  it('IN-09 上限は設定で変えられる', () => {
    const f = file('a'.repeat(3842))
    expect(unitAvailability('wholeFile', '', '', f, 5000).ok).toBe(true)
    expect(unitAvailability('wholeFile', '', '', f, 3842).ok).toBe(true)
    expect(unitAvailability('wholeFile', '', '', f, 3841).ok).toBe(false)
    expect(unitAvailability('wholeFile', '', '', file('a'.repeat(200)), 100).ok).toBe(false)
  })

  it('IN-11 ファイルを開いていなければ使えない', () => {
    const a = unitAvailability('wholeFile', '', '', null, LIMIT)
    expect(a.ok).toBe(false)
    expect(a.reason.length).toBeGreaterThan(0)
  })
})
