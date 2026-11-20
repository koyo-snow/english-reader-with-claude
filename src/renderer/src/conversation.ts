import type { ClaudeErrorKind } from '@shared/types'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: 'streaming' | 'done' | 'error'
  error?: { kind: ClaudeErrorKind; message: string }
}

export interface Conversation {
  id: string
  sessionId: string | null
  promptName: string
  sourcePath: string
  model: string
  messages: ChatMessage[]
  runId: string | null
  costUsd: number
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function errorTitle(kind: ClaudeErrorKind): string {
  switch (kind) {
    case 'cli-not-found':
      return 'Claude Code CLI が見つかりません'
    case 'not-logged-in':
      return 'Claude Code にログインしていません'
    case 'usage-limit':
      return '利用上限に達しています'
    case 'timeout':
      return 'タイムアウトしました'
    case 'aborted':
      return '停止しました'
    default:
      return 'エラーが発生しました'
  }
}

export function errorAdvice(kind: ClaudeErrorKind): string {
  switch (kind) {
    case 'cli-not-found':
      return 'ターミナルで claude をインストールするか、設定タブで claude の実行ファイルのパスを指定してください。'
    case 'not-logged-in':
      return 'ターミナルで claude を起動して /login を実行し、ログインしてから再度お試しください。'
    case 'usage-limit':
      return 'しばらく時間をおいてから再度お試しください。設定タブで軽いモデル（Haiku など）に切り替えるのも手です。'
    case 'timeout':
      return 'ネットワーク状況を確認して再度お試しください。'
    case 'aborted':
      return ''
    default:
      return '設定タブで claude のパスやモデルを確認してください。'
  }
}

/** 会話を Markdown にする。scope が latest なら最後の回答だけ。 */
export function conversationToMarkdown(c: Conversation, scope: 'conversation' | 'latest'): string {
  const done = c.messages.filter((m) => m.status !== 'error')
  if (scope === 'latest') {
    const last = [...done].reverse().find((m) => m.role === 'assistant')
    return last?.text ?? ''
  }
  return done
    .map((m) => (m.role === 'user' ? `## 質問\n\n${m.text}` : `## 回答\n\n${m.text}`))
    .join('\n\n---\n\n')
}
