// macOS の say コマンドで本文を読み上げる。同時に鳴らすのは 1 つだけ。
// 英語と日本語が混ざった文章は言語ごとの塊に分け、それぞれの言語の音声で順に読む。
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { SPEECH_RATE, clampSpeechRate, type SpeechState } from '@shared/types'

const SAY_PATH = '/usr/bin/say'

type Lang = 'en' | 'ja'

// タイムスタンプは数字として読まれて邪魔なので取り除く。
// 文中の「3:45 pm」のような時刻を巻き込まないよう、行頭の素のもの（00:12:34）と角括弧付き（[12:34]）だけを対象にする。
const TS_LINE_START_RE = /^[ \t]*\d{1,2}:\d{2}(?::\d{2})?(?=\s|$)/gm
const TS_BRACKET_RE = /\[\d{1,2}:\d{2}(?::\d{2})?\]/g

export function prepareSpeechText(text: string): string {
  return text
    .replace(TS_LINE_START_RE, '')
    .replace(TS_BRACKET_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// ---------- 言語判定と分割 ----------

const JA_CHAR_RE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/
const LATIN_CHAR_RE = /[A-Za-z]/

/** 日本語の文字が 1 つでもあれば日本語。日本語音声は英単語も読めるが、英語音声は日本語を読めないため。 */
function detectLang(segment: string): Lang | null {
  if (JA_CHAR_RE.test(segment)) return 'ja'
  if (LATIN_CHAR_RE.test(segment)) return 'en'
  return null // 数字や記号だけ。隣の塊にくっつける
}

// 同じ言語の文はひとつの say にまとめる（起動ごとに 1 秒近い間が空くため）。
// ただし速度変更時は塊の頭から読み直すので、戻りすぎないよう塊の長さに上限を設ける。
const MAX_CHUNK_CHARS = 500

/** 行→文の順に区切り、言語が同じ連続する文をまとめる。 */
export function splitByLanguage(text: string): { lang: Lang; text: string }[] {
  const segments = text
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+|(?<=[。！？])/))
    .map((s) => s.trim())
    .filter(Boolean)

  const chunks: { lang: Lang; text: string }[] = []
  let pendingNeutral: string[] = []
  for (const seg of segments) {
    const lang = detectLang(seg)
    if (lang === null) {
      pendingNeutral.push(seg)
      continue
    }
    const last = chunks[chunks.length - 1]
    const pieces = [...pendingNeutral, seg]
    pendingNeutral = []
    const piece = pieces.join(' ')
    if (last && last.lang === lang && last.text.length + 1 + piece.length <= MAX_CHUNK_CHARS) last.text += ' ' + piece
    else chunks.push({ lang, text: piece })
  }
  if (pendingNeutral.length) {
    const last = chunks[chunks.length - 1]
    if (last) last.text += ' ' + pendingNeutral.join(' ')
    else chunks.push({ lang: 'en', text: pendingNeutral.join(' ') })
  }
  return chunks
}

// ---------- 音声の選択 ----------

interface Voice {
  name: string
  locale: string
}

const PREFERRED: Record<Lang, string[]> = {
  ja: ['Kyoko (Enhanced)', 'Kyoko', 'Otoya (Enhanced)', 'Otoya'],
  en: ['Samantha', 'Ava', 'Alex', 'Daniel', 'Karen', 'Moira']
}

let voicesPromise: Promise<Voice[]> | null = null

/** `say -v ?` の一覧を解析して保持する。失敗時は空配列（-v を付けずに既定音声で読む）。 */
function listVoices(): Promise<Voice[]> {
  if (voicesPromise) return voicesPromise
  voicesPromise = new Promise((resolve) => {
    execFile(SAY_PATH, ['-v', '?'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve([])
        return
      }
      const voices: Voice[] = []
      for (const line of stdout.split('\n')) {
        // 例: "Kyoko (Enhanced)    ja_JP    # こんにちは! ..." / "Eddy (英語（アメリカ）)     en_US    # Hello! ..."
        const m = /^(.+?)\s+([a-z]{2,3}[_-][A-Za-z]{2,}(?:[_-][A-Za-z0-9]+)*)\s+#/.exec(line)
        if (m) voices.push({ name: m[1].trim(), locale: m[2] })
      }
      resolve(voices)
    })
  })
  return voicesPromise
}

async function pickVoice(lang: Lang): Promise<string | null> {
  const voices = await listVoices()
  const byName = new Map(voices.map((v) => [v.name, v]))
  for (const name of PREFERRED[lang]) if (byName.has(name)) return name
  const sameLang = voices.filter((v) => v.locale.toLowerCase().startsWith(lang + '_') || v.locale.toLowerCase().startsWith(lang + '-'))
  // 「Eddy (日本語（日本）)」のような新形式の名前より、素の名前の音声を優先する
  const plain = sameLang.find((v) => !v.name.includes('('))
  return plain?.name ?? sameLang[0]?.name ?? null
}

// ---------- 再生 ----------

type PlayResult = 'ok' | 'restart' | { error: string }

export class Speaker {
  private proc: ChildProcess | null = null
  private generation = 0
  private rate: number
  private restartRequested = false

  constructor(
    private readonly onState: (state: SpeechState) => void,
    rate = 1
  ) {
    this.rate = clampSpeechRate(rate)
  }

  /** 速度倍率を変える。再生中なら現在の塊を新しい速度で頭から読み直す。 */
  setRate(rate: number): void {
    const next = clampSpeechRate(rate)
    if (next === this.rate) return
    this.rate = next
    if (this.proc) {
      this.restartRequested = true
      this.proc.kill()
    }
  }

  speak(raw: string): void {
    this.stop()
    const text = prepareSpeechText(raw)
    const chunks = splitByLanguage(text)
    if (chunks.length === 0) {
      this.onState({ speaking: false, error: '読み上げる文章がありません' })
      return
    }
    const gen = ++this.generation
    this.onState({ speaking: true })
    void this.playSequence(chunks, gen)
  }

  private async playSequence(chunks: { lang: Lang; text: string }[], gen: number): Promise<void> {
    for (const chunk of chunks) {
      if (gen !== this.generation) return // stop() または次の読み上げで打ち切られた
      const voice = await pickVoice(chunk.lang)
      let result: PlayResult
      do {
        if (gen !== this.generation) return
        result = await this.playOne(chunk.text, voice, gen)
      } while (result === 'restart')
      if (gen !== this.generation) return
      if (result !== 'ok') {
        this.onState({ speaking: false, error: result.error })
        return
      }
    }
    if (gen === this.generation) this.onState({ speaking: false })
  }

  /** 1 つの塊を say で読む。速度変更で打ち切ったときは 'restart' を返す。 */
  private playOne(text: string, voice: string | null, gen: number): Promise<PlayResult> {
    return new Promise((resolve) => {
      let proc: ChildProcess
      const args = ['-r', String(Math.round(SPEECH_RATE.baseWpm * this.rate))]
      if (voice) args.push('-v', voice)
      try {
        // 本文は引数ではなく stdin で渡す（引数長の上限とクォートの問題を避ける）。
        proc = spawn(SAY_PATH, args, { stdio: ['pipe', 'ignore', 'pipe'] })
      } catch (e) {
        resolve({ error: (e as Error).message })
        return
      }
      this.proc = proc
      this.restartRequested = false
      let stderr = ''
      let settled = false
      const finish = (result: PlayResult) => {
        if (settled) return
        settled = true
        if (this.proc === proc) this.proc = null
        resolve(result)
      }
      proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
      proc.on('error', (err) => finish({ error: `say を起動できません: ${err.message}` }))
      proc.on('exit', (code, signal) => {
        if (gen !== this.generation) finish('ok')
        else if (signal) finish(this.restartRequested ? 'restart' : 'ok')
        else if (code === 0) finish('ok')
        else finish({ error: stderr.trim() || `say が終了コード ${code} で終了しました` })
      })
      proc.stdin?.on('error', () => {}) // 途中で停止したときの EPIPE を握りつぶす
      proc.stdin?.end(text)
    })
  }

  stop(): void {
    this.generation++
    const proc = this.proc
    if (!proc) return
    this.proc = null
    proc.kill()
    this.onState({ speaking: false })
  }
}
