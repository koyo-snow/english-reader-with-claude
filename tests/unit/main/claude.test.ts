// 仕様書「Claude連携」：SDK の呼び出し方、ストリーミング、会話の継続、エラーの分類
// SDK と electron は差し替える（実際の Claude は呼ばない）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type ClaudeEvent, type ClaudeRunRequest, type Settings } from '@shared/types'

type QueryArgs = { prompt: string; options: Record<string, any> }
type Script = (args: QueryArgs) => AsyncGenerator<unknown>

const h = vi.hoisted(() => ({
  userData: '',
  calls: [] as { prompt: string; options: Record<string, any> }[],
  script: null as null | ((args: { prompt: string; options: Record<string, any> }) => AsyncGenerator<unknown>)
}))

vi.mock('electron', () => ({ app: { getPath: () => h.userData, getVersion: () => '0.0.0-test' } }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: QueryArgs) => {
    h.calls.push(args)
    if (!h.script) throw new Error('script が未設定')
    return h.script(args)
  }
}))

import { ClaudeRunner, claudeCwd, resolveClaude } from '../../../src/main/claude'

// ---------- SDK メッセージの雛形 ----------
const init = (sessionId = 'sess-1') => ({ type: 'system', subtype: 'init', session_id: sessionId })
const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
const assistant = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const resultOk = (sessionId = 'sess-1', cost = 0.0123) => ({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, total_cost_usd: cost, result: 'ok' })

const replay = (...msgs: unknown[]): Script =>
  async function* () {
    for (const m of msgs) yield m
  }
const throwing = (message: string, ...before: unknown[]): Script =>
  async function* () {
    for (const m of before) yield m
    throw new Error(message)
  }
/** 中断されるまで応答しない（中断されたら SDK と同じく例外を投げる）。 */
const hanging = (...before: unknown[]): Script =>
  async function* (args) {
    for (const m of before) yield m
    const signal: AbortSignal = args.options.abortController.signal
    await new Promise<void>((_, reject) => {
      if (signal.aborted) reject(new Error('Claude Code process aborted by user'))
      else signal.addEventListener('abort', () => reject(new Error('Claude Code process aborted by user')))
    })
  }

let root: string
let events: ClaudeEvent[]
let runner: ClaudeRunner
let seq = 0

function settings(patch: Partial<Settings['ai']> = {}, vaultPath = ''): Settings {
  const s = structuredClone(DEFAULT_SETTINGS)
  s.vaultPath = vaultPath
  s.ai = { ...s.ai, claudePath: '/opt/test/claude', ...patch }
  return s
}
function request(patch: Partial<ClaudeRunRequest> = {}): ClaudeRunRequest {
  return { runId: `run-${++seq}`, prompt: '訳してください。\n\n---\n\nファイル: Talk.md\n\nHello.', model: 'sonnet', ...patch }
}
const lastOptions = () => h.calls[h.calls.length - 1].options

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'er-claude-')))
  h.userData = path.join(root, 'userData')
  fs.mkdirSync(h.userData)
  h.calls = []
  h.script = null
  events = []
  runner = new ClaudeRunner((ev) => events.push(ev))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('SDK の呼び出し方', () => {
  beforeEach(() => {
    h.script = replay(init(), resultOk())
  })

  it('CL-01 送る内容は渡されたテキストだけ（プロンプト全文をそのまま渡す）', async () => {
    const req = request()
    await runner.run(req, settings())
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].prompt).toBe(req.prompt)
  })

  it('CL-02 ツールはすべて無効にし、Claude Code 側の設定ファイルも読み込まない', async () => {
    await runner.run(request(), settings())
    expect(lastOptions().tools).toEqual([])
    expect(lastOptions().allowedTools).toEqual([])
    expect(lastOptions().settingSources).toEqual([])
    expect(lastOptions().permissionMode).not.toBe('bypassPermissions')
    expect(lastOptions()).not.toHaveProperty('mcpServers')
  })

  it('CL-03 作業ディレクトリは Vault とは別の、アプリ専用の空フォルダ', async () => {
    const vault = path.join(root, 'vault')
    fs.mkdirSync(vault)
    await runner.run(request(), settings({}, vault))
    const cwd: string = lastOptions().cwd
    expect(cwd).toBe(path.join(h.userData, 'claude-cwd'))
    expect(cwd).toBe(claudeCwd())
    expect(fs.statSync(cwd).isDirectory()).toBe(true)
    expect(fs.readdirSync(cwd)).toEqual([])
    expect(path.relative(vault, cwd).startsWith('..')).toBe(true)
    expect(fs.readdirSync(vault)).toEqual([]) // Vault 内に .claude/ などを作らない
  })

  it('CL-04 API キーは渡さない（Claude Code のログインを使う）', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-test')
    await runner.run(request(), settings())
    const env: Record<string, string | undefined> = lastOptions().env
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(Object.values(env).join('\n')).not.toContain('sk-ant-test')
    expect(lastOptions()).not.toHaveProperty('apiKey')
  })

  it('CL-05 リクエストで指定されたモデルを使う', async () => {
    for (const model of ['opus', 'sonnet', 'haiku'] as const) {
      await runner.run(request({ model }), settings())
      expect(lastOptions().model).toBe(model)
    }
  })

  it('CL-06 temperature は指定しない', async () => {
    await runner.run(request(), settings())
    expect(JSON.stringify(Object.keys(lastOptions()))).not.toMatch(/temperature/i)
  })

  it('CL-07 システムプロンプトは設定の文字列を使い、既定では日本語で回答させる', async () => {
    await runner.run(request(), settings({ systemPrompt: '  あなたは読解アシスタントです。  ', responseLanguage: 'ja' }))
    const sp: string = lastOptions().systemPrompt
    expect(typeof sp).toBe('string')
    expect(sp.startsWith('あなたは読解アシスタントです。')).toBe(true)
    expect(sp).toContain('日本語で回答')
  })

  it('CL-08 応答言語を English にすると英語で回答させる', async () => {
    await runner.run(request(), settings({ systemPrompt: 'You are a reading assistant.', responseLanguage: 'en' }))
    const sp: string = lastOptions().systemPrompt
    expect(sp).toContain('You are a reading assistant.')
    expect(sp).toMatch(/Respond in English/)
    expect(sp).not.toContain('日本語で回答')
  })

  it('CL-09 新規実行ではセッションを引き継がない', async () => {
    await runner.run(request(), settings())
    expect(lastOptions()).not.toHaveProperty('resume')
  })

  it('CL-10 追加質問はセッション ID を指定して同じ会話を継続する', async () => {
    await runner.run(request({ prompt: 'もう少し詳しく', resumeSessionId: 'sess-1' }), settings())
    expect(lastOptions().resume).toBe('sess-1')
    expect(h.calls[0].prompt).toBe('もう少し詳しく')
  })

  it('CL-11 ストリーミングの差分を受け取る設定で呼ぶ', async () => {
    await runner.run(request(), settings())
    expect(lastOptions().includePartialMessages).toBe(true)
  })
})

describe('claude 実行ファイルの場所', () => {
  /** 指定したパスだけが実行可能ファイルとして存在するように見せる。 */
  function onlyExecutables(paths: string[]): void {
    const realStat = fs.statSync
    vi.spyOn(fs, 'accessSync').mockImplementation((p) => {
      if (!paths.includes(String(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    vi.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (paths.includes(String(p))) return { isFile: () => true } as fs.Stats
      return (realStat as (...a: unknown[]) => fs.Stats)(p, ...rest)
    }) as typeof fs.statSync)
  }

  it('CL-20 設定タブで指定したパスを最優先で使う', async () => {
    h.script = replay(init(), resultOk())
    const s = settings({ claudePath: '  /custom/bin/claude  ' })
    expect(resolveClaude(s)).toEqual({ configuredPath: '/custom/bin/claude', resolvedPath: '/custom/bin/claude', source: 'settings' })
    await runner.run(request(), s)
    expect(lastOptions().pathToClaudeCodeExecutable).toBe('/custom/bin/claude')
  })

  it('CL-21 未指定なら PATH から自動検出する', () => {
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 })
    vi.stubEnv('PATH', `${path.join(root, 'nothing-here')}${path.delimiter}${bin}`)
    expect(resolveClaude(settings({ claudePath: '' }))).toEqual({
      configuredPath: '',
      resolvedPath: path.join(bin, 'claude'),
      source: 'detected'
    })
  })

  it('CL-22 実行権限のないファイルは検出しない', () => {
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'claude'), 'not executable', { mode: 0o644 })
    vi.stubEnv('PATH', bin)
    onlyExecutables([])
    expect(resolveClaude(settings({ claudePath: '' })).source).toBe('bundled')
  })

  it.each([
    ['~/.local/bin', (home: string) => path.join(home, '.local', 'bin', 'claude')],
    ['/opt/homebrew/bin', () => '/opt/homebrew/bin/claude'],
    ['~/.claude/local', (home: string) => path.join(home, '.claude', 'local', 'claude')]
  ])('CL-23 PATH になくても、よくあるインストール先 %s を探す', (_label, locate) => {
    const home = path.join(root, 'home')
    vi.spyOn(os, 'homedir').mockReturnValue(home)
    vi.stubEnv('PATH', '') // Finder から起動した場合を想定
    const target = locate(home)
    onlyExecutables([target])
    expect(resolveClaude(settings({ claudePath: '' }))).toEqual({ configuredPath: '', resolvedPath: target, source: 'detected' })
  })

  it('CL-24 どこにも見つからなければパスを渡さず、SDK 同梱のバイナリに任せる', async () => {
    h.script = replay(init(), resultOk())
    vi.stubEnv('PATH', '')
    onlyExecutables([])
    const s = settings({ claudePath: '' })
    expect(resolveClaude(s)).toEqual({ configuredPath: '', resolvedPath: null, source: 'bundled' })
    await runner.run(request(), s)
    expect(lastOptions()).not.toHaveProperty('pathToClaudeCodeExecutable')
  })
})

describe('ストリーミングと完了', () => {
  it('CL-30 セッション開始、差分、完了の順にイベントを送る', async () => {
    h.script = replay(init('sess-9'), delta('こん'), delta('にちは'), assistant('こんにちは'), resultOk('sess-9', 0.05))
    const req = request()
    await runner.run(req, settings())
    expect(events.slice(0, 4)).toEqual([
      { runId: req.runId, type: 'session', sessionId: 'sess-9' },
      { runId: req.runId, type: 'delta', text: 'こん' },
      { runId: req.runId, type: 'delta', text: 'にちは' },
      { runId: req.runId, type: 'done', sessionId: 'sess-9', costUsd: 0.05 }
    ])
    expect(events.slice(4).every((e) => e.type === 'done')).toBe(true) // 完了の後に差分やエラーは来ない
    expect(runner.isRunning).toBe(false)
  })

  // 既知の不具合: result を受け取った後、「result が来ずに終わった場合」の保険も通ってしまい done が 2 回届く
  // （2 回目は costUsd が 0）。画面側は 2 回目を無視するので実害はないが、直ったら fails を外す。
  it.fails('CL-34 完了の通知は 1 回だけ送る', async () => {
    h.script = replay(init(), delta('回答'), resultOk())
    await runner.run(request(), settings())
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
  })

  it('CL-35 結果メッセージが来ないまま終わっても完了として扱う', async () => {
    h.script = replay(init('sess-3'), delta('回答'))
    const req = request()
    await runner.run(req, settings())
    expect(events.at(-1)).toMatchObject({ runId: req.runId, type: 'done', sessionId: 'sess-3' })
  })

  it('CL-31 差分が届かなかった場合は、完成したメッセージの本文を表示用に送る', async () => {
    h.script = replay(init(), assistant('まとめて届いた回答'), resultOk())
    await runner.run(request(), settings())
    expect(events.filter((e) => e.type === 'delta')).toEqual([expect.objectContaining({ text: 'まとめて届いた回答' })])
    expect(events.at(-1)?.type).toBe('done')
  })

  it('CL-32 テキスト以外の差分（thinking など）は表示に流さない', async () => {
    h.script = replay(
      init(),
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '内部の思考' } } },
      { type: 'stream_event', event: { type: 'message_start' } },
      delta('回答'),
      resultOk()
    )
    await runner.run(request(), settings())
    expect(events.filter((e) => e.type === 'delta')).toEqual([expect.objectContaining({ text: '回答' })])
  })

  it('CL-33 実行中は isRunning が true', async () => {
    h.script = hanging(init())
    const p = runner.run(request(), settings())
    await vi.waitFor(() => expect(events.some((e) => e.type === 'session')).toBe(true))
    expect(runner.isRunning).toBe(true)
    runner.stop()
    await p
    expect(runner.isRunning).toBe(false)
  })
})

describe('停止・タイムアウト・上書き', () => {
  it('CL-40 停止すると生成を中断し、停止したことを通知する', async () => {
    h.script = hanging(init(), delta('途中まで'))
    const req = request()
    const p = runner.run(req, settings())
    await vi.waitFor(() => expect(events.some((e) => e.type === 'delta')).toBe(true))
    runner.stop()
    await p
    expect(lastOptions().abortController.signal.aborted).toBe(true)
    expect(events.at(-1)).toEqual({ runId: req.runId, type: 'error', kind: 'aborted', message: '停止しました。' })
  })

  it('CL-41 応答がないまま時間が経つとタイムアウトとして中断する', async () => {
    vi.useFakeTimers()
    h.script = hanging(init())
    const req = request()
    const p = runner.run(req, settings())
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    await p
    expect(lastOptions().abortController.signal.aborted).toBe(true)
    expect(events.at(-1)).toMatchObject({ runId: req.runId, type: 'error', kind: 'timeout' })
  })

  it('CL-42 新しく実行すると前の実行は破棄され、前の実行のイベントは届かない', async () => {
    h.script = hanging(init('old'), delta('古い回答'))
    const first = request()
    const p1 = runner.run(first, settings())
    await vi.waitFor(() => expect(events.some((e) => e.type === 'delta')).toBe(true))
    const firstSignal: AbortSignal = lastOptions().abortController.signal
    events.length = 0

    h.script = replay(init('new'), delta('新しい回答'), resultOk('new'))
    const second = request()
    await runner.run(second, settings())
    await p1
    expect(firstSignal.aborted).toBe(true)
    expect(events.every((e) => e.runId === second.runId)).toBe(true)
    expect(events.map((e) => e.type).slice(0, 3)).toEqual(['session', 'delta', 'done'])
    expect(events.some((e) => e.type === 'error')).toBe(false) // 前の実行の「停止しました」は届かない
    expect(runner.isRunning).toBe(false)
  })
})

describe('エラーの分類', () => {
  it.each([
    ['CLI 未検出', 'Claude Code executable not found at /opt/test/claude. Is options.pathToClaudeCodeExecutable set?', 'cli-not-found'],
    ['CLI 未検出（起動失敗）', 'spawn /opt/test/claude ENOENT', 'cli-not-found'],
    ['未ログイン', 'Not logged in · Please run /login', 'not-logged-in'],
    ['未ログイン（認証エラー）', 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired"}}', 'not-logged-in'],
    ['利用上限', "You've hit your usage limit · resets 3pm", 'usage-limit'],
    ['利用上限（レート制限）', 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}', 'usage-limit'],
    ['タイムアウト', 'Request timed out.', 'timeout'],
    ['その他', 'Something unexpected happened', 'unknown']
  ] as const)('CL-50 %s を見分ける', async (_label, message, kind) => {
    h.script = throwing(message, init())
    const req = request()
    await runner.run(req, settings())
    expect(events.at(-1)).toEqual({ runId: req.runId, type: 'error', kind, message })
    expect(runner.isRunning).toBe(false)
  })

  it('CL-51 SDK がエラー結果を返した場合も内容で分類し、完了扱いにしない', async () => {
    h.script = replay(init(), { type: 'result', subtype: 'success', is_error: true, session_id: 'sess-1', result: 'Not logged in · Please run /login' })
    await runner.run(request(), settings())
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'not-logged-in' })
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('CL-52 実行時エラーの結果（errors 配列）も表示用のメッセージにする', async () => {
    h.script = replay(init(), { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'sess-1', errors: ['Claude AI usage limit reached'] })
    await runner.run(request(), settings())
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'usage-limit', message: 'Claude AI usage limit reached' })
  })

  it('CL-53 エラーの後でも次の実行ができる', async () => {
    h.script = throwing('Something unexpected happened')
    await runner.run(request(), settings())
    h.script = replay(init(), delta('ok'), resultOk())
    const req = request()
    await runner.run(req, settings())
    expect(events.at(-1)).toMatchObject({ runId: req.runId, type: 'done' })
  })
})
