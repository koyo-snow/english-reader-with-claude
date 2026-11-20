// 仕様書「初期プロンプト」「設定JSON」「読み上げ速度」の既定値
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROMPTS,
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  DEFAULT_SYSTEM_PROMPT,
  DRAWER_LIMITS,
  INPUT_UNIT_LABELS,
  SPEECH_RATE,
  clampSpeechRate
} from '@shared/types'

describe('初期プロンプト', () => {
  // 仕様書の表（# / 名前 / 既定の入力単位）
  const SPEC_TABLE = [
    ['自然な日本語に訳す', 'paragraph'],
    ['直訳と意訳', 'selection'],
    ['単語・イディオムの意味', 'selection'],
    ['文法・構文の解説', 'selection'],
    ['技術用語・概念の解説', 'selection'],
    ['前提知識の補足', 'paragraph'],
    ['具体例・コードで説明', 'paragraph'],
    ['Mermaidで図解', 'paragraph'],
    ['字幕を読みやすく整形', 'paragraph'],
    ['要点を箇条書き', 'wholeFile'],
    ['理解度チェック', 'wholeFile']
  ] as const

  it('DP-01 仕様書の表と同じ 11 件が、同じ順番・名前・既定の入力単位で並ぶ', () => {
    expect(DEFAULT_PROMPTS.map((p) => [p.name, p.defaultInput])).toEqual(SPEC_TABLE.map((r) => [...r]))
  })

  it('DP-02 id は重複せず、本文は空でなく、モデルは未指定（既定モデルを使う）', () => {
    expect(new Set(DEFAULT_PROMPTS.map((p) => p.id)).size).toBe(DEFAULT_PROMPTS.length)
    for (const p of DEFAULT_PROMPTS) {
      expect(p.body.trim().length, p.name).toBeGreaterThan(0)
      expect(p.model, p.name).toBeNull()
    }
  })

  it('DP-03 プロンプト本文に {{selection}} などの変数を使わない', () => {
    for (const p of DEFAULT_PROMPTS) expect(p.body, p.name).not.toMatch(/\{\{.*?\}\}/)
  })

  it('DP-04 指示の要旨が本文に含まれる', () => {
    const body = (name: string) => DEFAULT_PROMPTS.find((p) => p.name === name)?.body ?? ''
    expect(body('自然な日本語に訳す')).toMatch(/技術用語は原語を括弧で残/)
    expect(body('直訳と意訳')).toMatch(/直訳/)
    expect(body('直訳と意訳')).toMatch(/意訳/)
    expect(body('単語・イディオムの意味')).toMatch(/品詞/)
    expect(body('単語・イディオムの意味')).toMatch(/発音記号/)
    expect(body('単語・イディオムの意味')).toMatch(/類義語/)
    expect(body('単語・イディオムの意味')).toMatch(/例文/)
    expect(body('文法・構文の解説')).toMatch(/主節と従属節/)
    expect(body('文法・構文の解説')).toMatch(/修飾関係/)
    expect(body('技術用語・概念の解説')).toMatch(/初学者/)
    expect(body('前提知識の補足')).toMatch(/前提知識/)
    expect(body('具体例・コードで説明')).toMatch(/コード例/)
    expect(body('Mermaidで図解')).toMatch(/Mermaid/)
    expect(body('字幕を読みやすく整形')).toMatch(/句読点/)
    expect(body('要点を箇条書き')).toMatch(/3〜7個/)
    expect(body('理解度チェック')).toMatch(/3〜5問/)
    expect(body('理解度チェック')).toMatch(/解答/)
  })
})

describe('設定の既定値（設定JSON）', () => {
  it('JSON-01 仕様書のサンプル JSON と同じ既定値を持つ', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      version: 1,
      theme: 'system',
      reader: {
        fontFamily: 'Inter',
        codeFontFamily: 'JetBrains Mono',
        fontSize: 17,
        lineHeight: 1.7,
        maxLineWidthCh: 72,
        showTimestamps: true,
        videoUrlKeys: ['url', 'source']
      },
      ai: {
        claudePath: '',
        defaultModel: 'sonnet',
        wholeFileCharLimit: 1000,
        responseLanguage: 'ja',
        systemPrompt: 'あなたは英語の技術文書の読解を助けるアシスタントです。日本語で回答してください。'
      },
      save: { folder: 'AI Notes', scope: 'conversation' },
      layout: {
        left: { open: true, width: 260 },
        right: { open: true, width: 320 },
        bottom: { open: false, height: 280 }
      }
    })
    expect(DEFAULT_SETTINGS.ai.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('JSON-02 先頭のプロンプトはサンプル JSON の translate-natural', () => {
    expect(DEFAULT_SETTINGS.prompts[0]).toMatchObject({
      id: 'translate-natural',
      name: '自然な日本語に訳す',
      defaultInput: 'paragraph',
      model: null,
      showInContextMenu: true
    })
    expect(DEFAULT_SETTINGS.prompts[0].body).toContain(
      '次の英文を自然な日本語に訳してください。技術用語は原語を括弧で残してください。'
    )
  })

  it('JSON-03 state.json の既定値は空の読書位置・ハイライト・ツリー開閉・最後のファイル', () => {
    expect(DEFAULT_STATE).toEqual({ version: 1, scroll: {}, highlights: {}, treeOpen: [], lastFile: null, window: null })
  })

  it('LAY-10 ドロワーの既定の幅は最小・最大の範囲に収まる', () => {
    const { layout } = DEFAULT_SETTINGS
    expect(layout.left.width).toBeGreaterThanOrEqual(DRAWER_LIMITS.left.min)
    expect(layout.left.width).toBeLessThanOrEqual(DRAWER_LIMITS.left.max)
    expect(layout.right.width).toBeGreaterThanOrEqual(DRAWER_LIMITS.right.min)
    expect(layout.right.width).toBeLessThanOrEqual(DRAWER_LIMITS.right.max)
    expect(layout.bottom.height).toBeGreaterThanOrEqual(DRAWER_LIMITS.bottom.min)
    expect(layout.bottom.height).toBeLessThanOrEqual(DRAWER_LIMITS.bottom.max)
    for (const side of ['left', 'right', 'bottom'] as const) {
      expect(DRAWER_LIMITS[side].min).toBeLessThan(DRAWER_LIMITS[side].max)
    }
  })

  it('IN-10 入力単位は 選択範囲／段落／ファイル全体 の 3 つ', () => {
    expect(INPUT_UNIT_LABELS).toEqual({ selection: '選択範囲', paragraph: '段落', wholeFile: 'ファイル全体' })
  })
})

describe('読み上げ速度', () => {
  it('SP-20 範囲は 0.3×〜3.0×、0.1 刻み、基準は 175 語/分、既定は 1.0×', () => {
    expect(SPEECH_RATE).toEqual({ min: 0.3, max: 3, step: 0.1, baseWpm: 175 })
    expect(DEFAULT_SETTINGS.speech.rate).toBe(1)
  })

  it('SP-21 範囲外の値は 0.3〜3.0 に丸め、数値でなければ 1.0 にする', () => {
    expect(clampSpeechRate(0.1)).toBe(0.3)
    expect(clampSpeechRate(9)).toBe(3)
    expect(clampSpeechRate(1.5)).toBe(1.5)
    expect(clampSpeechRate(0.30000000000000004)).toBe(0.3)
    expect(clampSpeechRate(undefined)).toBe(1)
    expect(clampSpeechRate('2')).toBe(1)
    expect(clampSpeechRate(Number.NaN)).toBe(1)
  })
})
