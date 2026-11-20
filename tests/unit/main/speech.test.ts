// 仕様書「読み上げ」「言語ごとの音声」「読み上げ速度」
// say コマンドは差し替える（実際には鳴らさない）。
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeechState } from '@shared/types'

interface FakeProc extends EventEmitter {
  command: string
  args: string[]
  input: string
  killed: boolean
  stderr: EventEmitter
  exit(code?: number, stderr?: string): void
}

const h = vi.hoisted(() => ({
  spawned: [] as any[],
  voices: '',
  voicesFail: false
}))

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      if (h.voicesFail) cb(new Error('say failed'), '')
      else cb(null, h.voices)
    },
    spawn: (command: string, args: string[]) => {
      const proc = new EventEmitter() as any
      proc.command = command
      proc.args = args
      proc.input = ''
      proc.killed = false
      proc.stderr = new EventEmitter()
      proc.stdin = {
        on: () => {},
        end: (text: string) => {
          proc.input = text
        }
      }
      proc.kill = () => {
        if (proc.killed) return
        proc.killed = true
        setTimeout(() => proc.emit('exit', null, 'SIGTERM'), 0)
      }
      proc.exit = (code = 0, stderr = '') => {
        if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
        proc.emit('exit', code, null)
      }
      h.spawned.push(proc)
      return proc
    }
  }
})

const VOICES = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Kyoko               ja_JP    # こんにちは! 私の名前はKyokoです。',
  'Samantha            en_US    # Hello! My name is Samantha.',
  'Thomas              fr_FR    # Bonjour! Je m’appelle Thomas.'
].join('\n')

type SpeechModule = typeof import('../../../src/main/speech')
let speech: SpeechModule
let states: SpeechState[]

const procs = () => h.spawned as FakeProc[]
const waitForProc = async (n: number): Promise<FakeProc> => {
  await vi.waitFor(() => expect(procs().length).toBeGreaterThanOrEqual(n))
  return procs()[n - 1]
}
const argAfter = (p: FakeProc, flag: string) => (p.args.includes(flag) ? p.args[p.args.indexOf(flag) + 1] : undefined)

beforeEach(async () => {
  h.spawned = []
  h.voices = VOICES
  h.voicesFail = false
  states = []
  vi.resetModules() // 音声一覧のキャッシュをテストごとに捨てる
  speech = await import('../../../src/main/speech')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('読み上げる文章の前処理', () => {
  it('SP-01 行頭のタイムスタンプ（00:12:34）を除く', () => {
    const out = speech.prepareSpeechText('00:12:34 The event loop is simple.\n12:40 It runs callbacks.\n  1:02:03 Indented too.')
    expect(out.split('\n').map((l) => l.trim())).toEqual(['The event loop is simple.', 'It runs callbacks.', 'Indented too.'])
  })

  it('SP-02 角括弧付きのタイムスタンプ（[12:34]）は位置に関わらず除く', () => {
    const out = speech.prepareSpeechText('[12:34] Hello there. And [00:12:40] again.')
    expect(out).not.toMatch(/\d{1,2}:\d{2}/)
    expect(out).toContain('Hello there.')
    expect(out).toContain('again.')
  })

  it('SP-03 文中の時刻（3:45 pm）は除かない', () => {
    expect(speech.prepareSpeechText('The meeting starts at 3:45 pm today.')).toBe('The meeting starts at 3:45 pm today.')
  })

  it('SP-04 タイムスタンプだけの行は残さない', () => {
    const out = speech.prepareSpeechText('00:00:05\nWelcome.\n\n00:00:09\nLet us begin.')
    expect(out.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual(['Welcome.', 'Let us begin.'])
  })
})

describe('言語ごとの分割', () => {
  it('SP-10 英語の文は英語、日本語の文字を含む文は日本語として、順番を保って分ける', () => {
    const chunks = speech.splitByLanguage('This is English. これは日本語です。Back to English again.')
    expect(chunks).toEqual([
      { lang: 'en', text: 'This is English.' },
      { lang: 'ja', text: 'これは日本語です。' },
      { lang: 'en', text: 'Back to English again.' }
    ])
  })

  it('SP-11 英単語が混ざっていても、日本語の文字を含む文は日本語の音声で読む', () => {
    expect(speech.splitByLanguage('event loop はノンブロッキングの仕組みです。')).toEqual([
      { lang: 'ja', text: 'event loop はノンブロッキングの仕組みです。' }
    ])
  })

  it('SP-12 同じ言語が続く文は 1 つの塊にまとめる', () => {
    const chunks = speech.splitByLanguage('First sentence. Second sentence!\nThird sentence?')
    expect(chunks).toEqual([{ lang: 'en', text: 'First sentence. Second sentence! Third sentence?' }])
  })

  it('SP-13 1 つの塊は約 500 文字までに抑える', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog near the river bank.' // 64 文字
    const text = Array.from({ length: 40 }, () => sentence).join(' ')
    const chunks = speech.splitByLanguage(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.lang).toBe('en')
      expect(c.text.length).toBeLessThanOrEqual(500)
    }
    expect(chunks.map((c) => c.text).join(' ')).toBe(text)
  })

  it('SP-14 数字や記号だけの部分は捨てずに隣の塊に含める', () => {
    const joined = speech.splitByLanguage('2024.\nThe year started well.\n100%').map((c) => c.text).join(' ')
    expect(joined).toContain('2024.')
    expect(joined).toContain('The year started well.')
    expect(joined).toContain('100%')
  })

  it('SP-15 空の文章からは塊を作らない', () => {
    expect(speech.splitByLanguage('')).toEqual([])
    expect(speech.splitByLanguage('  \n \n')).toEqual([])
  })
})

describe('say コマンドでの再生', () => {
  const speaker = (rate?: number) => new speech.Speaker((s) => states.push(s), rate)

  it('SP-30 macOS の say で読み上げ、本文は標準入力で渡す', async () => {
    speaker().speak('00:00:05 Hello world.')
    const p = await waitForProc(1)
    expect(p.command).toBe('/usr/bin/say')
    expect(p.input).toBe('Hello world.')
    expect(p.args).not.toContain('Hello world.')
    expect(states).toEqual([{ speaking: true }])
    p.exit(0)
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ speaking: false }))
  })

  it('SP-31 英語の文は英語の音声、日本語の文は日本語の音声で、順に読む', async () => {
    speaker().speak('The event loop. イベントループです。')
    const en = await waitForProc(1)
    expect(argAfter(en, '-v')).toBe('Samantha')
    expect(en.input).toBe('The event loop.')
    expect(procs()).toHaveLength(1) // 英語を読み終えるまで日本語は始めない
    en.exit(0)
    const ja = await waitForProc(2)
    expect(argAfter(ja, '-v')).toBe('Kyoko')
    expect(ja.input).toBe('イベントループです。')
    ja.exit(0)
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ speaking: false }))
    expect(procs()).toHaveLength(2)
  })

  it('SP-32 優先の音声がなければ、say -v ? の一覧から同じ言語の音声を選ぶ', async () => {
    h.voices = ['Fred                en_US    # Hello! My name is Fred.', 'Hattori             ja_JP    # こんにちは! 私の名前はHattoriです。'].join('\n')
    speaker().speak('Hello. こんにちは。')
    const en = await waitForProc(1)
    expect(argAfter(en, '-v')).toBe('Fred')
    en.exit(0)
    const ja = await waitForProc(2)
    expect(argAfter(ja, '-v')).toBe('Hattori')
  })

  it('SP-33 該当する言語の音声がなければ、音声を指定せず macOS の既定音声で読む', async () => {
    h.voices = 'Thomas              fr_FR    # Bonjour! Je m’appelle Thomas.'
    speaker().speak('Hello.')
    const p = await waitForProc(1)
    expect(p.args).not.toContain('-v')
  })

  it('SP-34 音声一覧を取得できなくても既定音声で読む', async () => {
    h.voicesFail = true
    speaker().speak('Hello.')
    const p = await waitForProc(1)
    expect(p.args).not.toContain('-v')
  })

  it.each([
    [1, '175'],
    [0.3, '53'],
    [1.5, '263'],
    [2, '350'],
    [3, '525']
  ])('SP-35 速度 %s× は say -r に 175 語/分 × 倍率（%s）として渡す', async (rate, wpm) => {
    speaker(rate).speak('Hello.')
    const p = await waitForProc(1)
    expect(argAfter(p, '-r')).toBe(wpm)
  })

  it('SP-36 停止すると途中で止まり、読み上げ中でなくなる', async () => {
    const sp = speaker()
    sp.speak('First part. 二つ目です。')
    const p = await waitForProc(1)
    sp.stop()
    expect(p.killed).toBe(true)
    expect(states.at(-1)).toEqual({ speaking: false })
    await new Promise((r) => setTimeout(r, 30))
    expect(procs()).toHaveLength(1) // 残りの塊は読まない
    expect(states.at(-1)).toEqual({ speaking: false })
  })

  it('SP-37 別の読み上げを始めると前のものは止まる', async () => {
    const sp = speaker()
    sp.speak('The first text. 続きの文です。')
    const first = await waitForProc(1)
    sp.speak('The second text.')
    expect(first.killed).toBe(true)
    const second = await waitForProc(2)
    expect(second.input).toBe('The second text.')
    await new Promise((r) => setTimeout(r, 30))
    expect(procs()).toHaveLength(2) // 前の読み上げの続き（日本語の塊）は始まらない
    expect(states.at(-1)).toEqual({ speaking: true })
    second.exit(0)
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ speaking: false }))
  })

  it('SP-38 読み上げ中に速度を変えると、いま読んでいる塊の頭から新しい速度で読み直す', async () => {
    const sp = speaker(1)
    sp.speak('English part here. 日本語の部分です。')
    const first = await waitForProc(1)
    expect(argAfter(first, '-r')).toBe('175')
    sp.setRate(2)
    expect(first.killed).toBe(true)
    const again = await waitForProc(2)
    expect(again.input).toBe('English part here.') // 同じ塊を頭から
    expect(argAfter(again, '-r')).toBe('350')
    expect(states.every((s) => s.speaking)).toBe(true) // 読み直しの間も「読み上げ中」のまま
    again.exit(0)
    const next = await waitForProc(3)
    expect(next.input).toBe('日本語の部分です。')
    expect(argAfter(next, '-r')).toBe('350')
  })

  it('SP-39 読み上げていないときに変えた速度は次の読み上げから使う', async () => {
    const sp = speaker(1)
    sp.setRate(0.5)
    sp.speak('Hello.')
    const p = await waitForProc(1)
    expect(argAfter(p, '-r')).toBe('88')
    expect(procs()).toHaveLength(1)
  })

  it('SP-40 範囲外の速度は 0.3×〜3.0× に収めて渡す', async () => {
    const sp = speaker(99)
    sp.speak('Hello.')
    expect(argAfter(await waitForProc(1), '-r')).toBe('525')
  })

  it('SP-41 読み上げる文章がなければ say を起動せず、その旨を知らせる', async () => {
    speaker().speak('00:00:05\n[12:34]\n')
    await new Promise((r) => setTimeout(r, 20))
    expect(procs()).toHaveLength(0)
    expect(states).toEqual([{ speaking: false, error: '読み上げる文章がありません' }])
  })

  it('SP-42 say が失敗したらエラーを知らせて止まる', async () => {
    speaker().speak('Hello. こんにちは。')
    const p = await waitForProc(1)
    p.exit(1, 'Voice `Samantha` not found.')
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ speaking: false, error: 'Voice `Samantha` not found.' }))
    expect(procs()).toHaveLength(1)
  })
})
