// 下ドロワー：AI の出力（会話）を表示し、追加質問・停止・コピー・保存を行う。
import { useEffect, useRef, useState } from 'react'
import { MarkdownView } from '../MarkdownView'
import { errorAdvice, errorTitle, type ChatMessage, type Conversation } from '../conversation'

interface Props {
  conversation: Conversation | null
  dark: boolean
  running: boolean
  onFollowUp: (text: string) => void
  onStop: () => void
  onSave: () => Promise<string>
  saveScope: 'conversation' | 'latest'
  onOpenSettings: () => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="tb-btn small"
      title="Markdown をコピー"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? '✓ コピー済み' : 'コピー'}
    </button>
  )
}

function Message({ m, dark, onOpenSettings }: { m: ChatMessage; dark: boolean; onOpenSettings: () => void }) {
  if (m.role === 'user') {
    return (
      <div className="chat-msg user">
        <div className="chat-role">質問</div>
        <pre className="chat-user-text">{m.text}</pre>
      </div>
    )
  }
  return (
    <div className={`chat-msg assistant ${m.status}`}>
      <div className="chat-role">
        回答
        {m.status === 'streaming' && <span className="spinner" />}
        <span className="toolbar-spacer" />
        {m.text && <CopyButton text={m.text} />}
      </div>
      {m.text ? <MarkdownView markdown={m.text} dark={dark} className="chat-body" /> : m.status === 'streaming' ? <div className="muted">考え中…</div> : null}
      {m.error && m.error.kind !== 'aborted' && (
        <div className="chat-error">
          <div className="chat-error-title">{errorTitle(m.error.kind)}</div>
          <div>{errorAdvice(m.error.kind)}</div>
          <details>
            <summary>詳細</summary>
            <pre>{m.error.message}</pre>
          </details>
          <button className="link" onClick={onOpenSettings}>
            設定タブを開く
          </button>
        </div>
      )}
      {m.error?.kind === 'aborted' && <div className="muted">（停止しました）</div>}
    </div>
  )
}

export function BottomDrawer({ conversation, dark, running, onFollowUp, onStop, onSave, saveScope, onOpenSettings }: Props) {
  const [input, setInput] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // ストリーミング中は末尾に追従（ユーザーが上にスクロールしたら止める）
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const onScroll = () => {
      stickToBottom.current = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40
    }
    sc.addEventListener('scroll', onScroll)
    return () => sc.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const sc = scrollRef.current
    if (sc && stickToBottom.current) sc.scrollTop = sc.scrollHeight
  })
  useEffect(() => {
    stickToBottom.current = true
    setSaveMsg(null)
  }, [conversation?.id])

  const submit = () => {
    const t = input.trim()
    if (!t || running || !conversation) return
    onFollowUp(t)
    setInput('')
  }

  const hasAnswer = conversation?.messages.some((m) => m.role === 'assistant' && m.status === 'done' && m.text)

  return (
    <div className="bottom-drawer">
      <div className="pane-header">
        <span>AI の出力</span>
        {conversation && (
          <span className="muted small-text">
            {conversation.promptName} · {conversation.sourcePath} · {conversation.model}
          </span>
        )}
        <span className="toolbar-spacer" />
        {saveMsg && <span className="muted small-text">{saveMsg}</span>}
        <button
          className="tb-btn small"
          disabled={!hasAnswer || running}
          title={saveScope === 'conversation' ? '会話全体を Vault に保存' : '最新の回答を Vault に保存'}
          onClick={async () => {
            try {
              const p = await onSave()
              setSaveMsg(`保存しました: ${p}`)
            } catch (err) {
              setSaveMsg(`保存に失敗: ${err instanceof Error ? err.message : String(err)}`)
            }
          }}
        >
          出力を保存
        </button>
      </div>
      <div ref={scrollRef} className="chat-scroll">
        {!conversation ? (
          <div className="reader-empty">右ドロワーまたは右クリックメニューからプロンプトを実行すると、ここに回答が表示されます。</div>
        ) : (
          conversation.messages.map((m) => <Message key={m.id} m={m} dark={dark} onOpenSettings={onOpenSettings} />)
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          rows={2}
          placeholder={conversation ? '続けて質問する（Enter で送信、Shift+Enter で改行）' : '先にプロンプトを実行してください'}
          disabled={!conversation || running}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {running ? (
          <button className="btn danger" onClick={onStop}>
            停止
          </button>
        ) : (
          <button className="btn primary" disabled={!conversation || !input.trim()} onClick={submit}>
            送信
          </button>
        )}
      </div>
    </div>
  )
}
