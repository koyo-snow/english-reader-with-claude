// Claude Agent SDK 経由で Claude Code CLI を呼び出す。ツールはすべて無効。
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeErrorKind, ClaudeEvent, ClaudeInfo, ClaudeRunRequest, Settings } from '@shared/types'

const IDLE_TIMEOUT_MS = 180_000

const CANDIDATE_PATHS = (): string[] => {
  const home = os.homedir()
  return [
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.claude', 'local', 'node_modules', '.bin', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.volta', 'bin', 'claude'),
    path.join(home, '.bun', 'bin', 'claude')
  ]
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 設定 → PATH → よくあるインストール先の順で claude を探す。見つからなければ SDK 同梱のバイナリに任せる。 */
export function resolveClaude(settings: Settings): ClaudeInfo {
  const configured = settings.ai.claudePath.trim()
  if (configured) {
    return { configuredPath: configured, resolvedPath: configured, source: 'settings' }
  }
  const fromPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((d) => path.join(d, 'claude'))
  for (const p of [...fromPath, ...CANDIDATE_PATHS()]) {
    if (isExecutable(p)) return { configuredPath: '', resolvedPath: p, source: 'detected' }
  }
  return { configuredPath: '', resolvedPath: null, source: 'bundled' }
}

export function claudeCwd(): string {
  const dir = path.join(app.getPath('userData'), 'claude-cwd')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function classifyError(message: string): ClaudeErrorKind {
  const m = message.toLowerCase()
  if (/executable_not_found|not found at|enoent|no such file/.test(m)) return 'cli-not-found'
  if (/not logged in|please run \/login|login|authentication|unauthori|invalid api key|oauth|credential/.test(m))
    return 'not-logged-in'
  if (/usage limit|rate limit|rate_limit|limit reached|credits|quota|too many requests|429|overloaded/.test(m))
    return 'usage-limit'
  if (/timed out|timeout/.test(m)) return 'timeout'
  if (/abort/.test(m)) return 'aborted'
  return 'unknown'
}

function languageInstruction(lang: Settings['ai']['responseLanguage']): string {
  return lang === 'en' ? 'Respond in English.' : '日本語で回答してください。'
}

export class ClaudeRunner {
  private current: { runId: string; abort: AbortController } | null = null

  constructor(private send: (ev: ClaudeEvent) => void) {}

  get isRunning(): boolean {
    return this.current !== null
  }

  stop(): void {
    this.current?.abort.abort()
  }

  async run(req: ClaudeRunRequest, settings: Settings): Promise<void> {
    this.stop()
    const abort = new AbortController()
    this.current = { runId: req.runId, abort }
    const emit = (ev: ClaudeEvent) => {
      if (this.current?.runId === req.runId) this.send(ev)
    }

    const info = resolveClaude(settings)
    const env: Record<string, string | undefined> = { ...process.env }
    // サブスクリプションのログインを使うため、API キーや入れ子起動のマーカーは渡さない
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.CLAUDECODE
    delete env.CLAUDE_CODE_ENTRYPOINT
    env.CLAUDE_AGENT_SDK_CLIENT_APP = `english-reader/${app.getVersion()}`

    const options: Options = {
      abortController: abort,
      cwd: claudeCwd(),
      model: req.model,
      systemPrompt: `${settings.ai.systemPrompt.trim()}\n\n${languageInstruction(settings.ai.responseLanguage)}`,
      tools: [],
      allowedTools: [],
      permissionMode: 'default',
      settingSources: [],
      maxTurns: 2,
      includePartialMessages: true,
      persistSession: true,
      env,
      ...(info.resolvedPath ? { pathToClaudeCodeExecutable: info.resolvedPath } : {}),
      ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {})
    }

    let sessionId = req.resumeSessionId ?? ''
    let lastErrorText = ''
    let gotDelta = false
    let idleTimer: NodeJS.Timeout | null = null
    let timedOut = false
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        timedOut = true
        abort.abort()
      }, IDLE_TIMEOUT_MS)
    }

    try {
      touch()
      const q = query({ prompt: req.prompt, options })
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        touch()
        if (msg.type === 'system' && msg.subtype === 'init') {
          sessionId = msg.session_id
          emit({ runId: req.runId, type: 'session', sessionId })
        } else if (msg.type === 'stream_event') {
          const ev = msg.event
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            gotDelta = true
            emit({ runId: req.runId, type: 'delta', text: ev.delta.text })
          }
        } else if (msg.type === 'assistant') {
          // ストリーミングが届かなかった場合の保険として、完成メッセージの本文を使う
          if (!gotDelta) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) emit({ runId: req.runId, type: 'delta', text: block.text })
            }
          }
          if (msg.error) lastErrorText = String(msg.error)
        } else if (msg.type === 'result') {
          sessionId = msg.session_id || sessionId
          if (msg.is_error || msg.subtype !== 'success') {
            const text =
              ('errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('\n') : '') ||
              ('result' in msg && typeof msg.result === 'string' ? msg.result : '') ||
              lastErrorText ||
              msg.subtype
            throw new Error(text)
          }
          emit({ runId: req.runId, type: 'done', sessionId, costUsd: msg.total_cost_usd ?? 0 })
        }
      }
      // result が来ずに終わった場合
      if (this.current?.runId === req.runId && !abort.signal.aborted) {
        emit({ runId: req.runId, type: 'done', sessionId, costUsd: 0 })
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      if (timedOut) {
        emit({ runId: req.runId, type: 'error', kind: 'timeout', message: `${IDLE_TIMEOUT_MS / 1000}秒間応答がなかったため中断しました。` })
      } else if (abort.signal.aborted) {
        emit({ runId: req.runId, type: 'error', kind: 'aborted', message: '停止しました。' })
      } else {
        const kind = classifyError(raw)
        emit({ runId: req.runId, type: 'error', kind, message: raw })
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      if (this.current?.runId === req.runId) this.current = null
    }
  }
}
