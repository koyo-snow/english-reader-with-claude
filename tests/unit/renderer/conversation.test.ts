// 仕様書「出力を保存（保存範囲）」「エラー表示」
import { describe, expect, it } from 'vitest'
import { conversationToMarkdown, errorAdvice, errorTitle, newId, type ChatMessage, type Conversation } from '../../../src/renderer/src/conversation'
import type { ClaudeErrorKind } from '@shared/types'

const msg = (role: ChatMessage['role'], text: string, status: ChatMessage['status'] = 'done'): ChatMessage => ({ id: newId(), role, text, status })
function conv(messages: ChatMessage[]): Conversation {
  return { id: 'c1', sessionId: 'sess-1', promptName: '自然な日本語に訳す', sourcePath: 'videos/Talk.md', model: 'sonnet', messages, runId: null, costUsd: 0 }
}

describe('保存する内容', () => {
  const c = conv([msg('user', '最初の質問'), msg('assistant', '最初の回答'), msg('user', '追加の質問'), msg('assistant', '**追加**の回答')])

  it('OUT-30 保存範囲が「会話全体」なら、質問と回答をすべて上から順に含める', () => {
    const md = conversationToMarkdown(c, 'conversation')
    const order = ['最初の質問', '最初の回答', '追加の質問', '**追加**の回答'].map((t) => md.indexOf(t))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(md.match(/^## 質問$/gm)).toHaveLength(2)
    expect(md.match(/^## 回答$/gm)).toHaveLength(2)
  })

  it('OUT-31 保存範囲が「最新の回答のみ」なら、最後の回答だけを Markdown のまま含める', () => {
    expect(conversationToMarkdown(c, 'latest')).toBe('**追加**の回答')
  })

  it('OUT-32 エラーになった回答は保存内容に含めない', () => {
    const withError = conv([msg('user', 'Q1'), msg('assistant', 'A1'), msg('user', 'Q2'), msg('assistant', '途中', 'error')])
    expect(conversationToMarkdown(withError, 'latest')).toBe('A1')
    expect(conversationToMarkdown(withError, 'conversation')).not.toContain('途中')
  })

  it('OUT-33 回答がなければ保存する内容は空', () => {
    expect(conversationToMarkdown(conv([msg('user', 'Q1'), msg('assistant', '', 'error')]), 'latest')).toBe('')
  })
})

describe('エラーの表示文言', () => {
  const kinds: ClaudeErrorKind[] = ['cli-not-found', 'not-logged-in', 'usage-limit', 'timeout']

  it('CL-60 CLI 未検出・未ログイン・利用上限・タイムアウトを、それぞれ別のわかる言葉で表示する', () => {
    const titles = kinds.map(errorTitle)
    expect(new Set(titles).size).toBe(kinds.length)
    expect(errorTitle('cli-not-found')).toMatch(/見つかりません/)
    expect(errorTitle('not-logged-in')).toMatch(/ログイン/)
    expect(errorTitle('usage-limit')).toMatch(/利用上限/)
    expect(errorTitle('timeout')).toMatch(/タイムアウト/)
    for (const t of titles) expect(t).not.toMatch(/ENOENT|401|429|undefined/)
  })

  it('CL-61 それぞれに対処方法を添える', () => {
    for (const k of kinds) expect(errorAdvice(k).length, k).toBeGreaterThan(0)
    expect(errorAdvice('cli-not-found')).toMatch(/設定タブ/)
    expect(errorAdvice('not-logged-in')).toMatch(/\/login/)
  })

  it('CL-62 分類できないエラーにも表示と対処方法がある', () => {
    expect(errorTitle('unknown').length).toBeGreaterThan(0)
    expect(errorAdvice('unknown')).toMatch(/設定タブ/)
  })
})

describe('ID', () => {
  it('PM-10 新しく作る ID は重複しない', () => {
    const ids = Array.from({ length: 500 }, () => newId())
    expect(new Set(ids).size).toBe(500)
  })
})
