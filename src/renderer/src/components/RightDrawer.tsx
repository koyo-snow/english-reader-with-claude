// 右ドロワー：入力単位とプロンプトを選んで実行する。入力単位の読み上げもここから。
import type { FileContent, InputUnit, PromptDef } from '@shared/types'
import { INPUT_UNIT_LABELS, SPEECH_RATE } from '@shared/types'

export const FREE_PROMPT_ID = '__free__'

interface Props {
  prompts: PromptDef[]
  selectedPromptId: string
  onSelectPrompt: (id: string) => void
  unit: InputUnit
  onSelectUnit: (u: InputUnit) => void
  freeText: string
  onFreeTextChange: (t: string) => void
  selection: string
  paragraph: string
  file: FileContent | null
  charLimit: number
  running: boolean
  onRun: () => void
  onStop: () => void
  speaking: boolean
  speechError: string | null
  onSpeak: () => void
  onStopSpeak: () => void
  speechRate: number
  onSpeechRateChange: (rate: number) => void
}

export function unitAvailability(
  unit: InputUnit,
  selection: string,
  paragraph: string,
  file: FileContent | null,
  charLimit: number
): { ok: boolean; reason: string; text: string; note?: string } {
  switch (unit) {
    case 'selection':
      // 未選択なら右クリックメニューと同じく段落にフォールバックする
      if (selection) return { ok: true, reason: '', text: selection }
      if (paragraph) return { ok: true, reason: '', text: paragraph, note: '何も選択していないので段落を送ります' }
      return { ok: false, reason: '本文で選択するか、段落をクリックしてください', text: '' }
    case 'paragraph':
      return paragraph ? { ok: true, reason: '', text: paragraph } : { ok: false, reason: '段落をクリックして指定してください', text: '' }
    case 'wholeFile':
      if (!file) return { ok: false, reason: 'ファイルを開いていません', text: '' }
      if (file.charCount > charLimit)
        return {
          ok: false,
          reason: `本文が${charLimit.toLocaleString()}文字を超えるため使えません（${file.charCount.toLocaleString()}文字）`,
          text: ''
        }
      return { ok: true, reason: '', text: file.body.trim() }
  }
}

export function RightDrawer(props: Props) {
  const { prompts, selectedPromptId, onSelectPrompt, unit, onSelectUnit, freeText, onFreeTextChange, selection, paragraph, file, charLimit, running, onRun, onStop, speaking, speechError, onSpeak, onStopSpeak, speechRate, onSpeechRateChange } = props
  const isFree = selectedPromptId === FREE_PROMPT_ID
  const prompt = prompts.find((p) => p.id === selectedPromptId) ?? null
  const avail = unitAvailability(unit, selection, paragraph, file, charLimit)
  const previewLines = avail.text.split('\n').slice(0, 4)
  const canRun = avail.ok && (isFree ? freeText.trim().length > 0 : prompt !== null)

  return (
    <div className="right-drawer">
      <div className="pane-header">AI への入力</div>
      <div className="pane-section">
        <div className="label">入力単位</div>
        <div className="segmented">
          {(['selection', 'paragraph', 'wholeFile'] as InputUnit[]).map((u) => {
            const a = unitAvailability(u, selection, paragraph, file, charLimit)
            return (
              <button
                key={u}
                className={`seg ${unit === u ? 'active' : ''}`}
                disabled={!a.ok}
                title={a.ok ? '' : a.reason}
                onClick={() => onSelectUnit(u)}
              >
                {INPUT_UNIT_LABELS[u]}
              </button>
            )
          })}
        </div>
        {!avail.ok && <div className="hint warn">{avail.reason}</div>}
        {avail.ok && avail.note && <div className="hint">{avail.note}</div>}
      </div>

      <div className="pane-section">
        <div className="label">プロンプト</div>
        <select value={selectedPromptId} onChange={(e) => onSelectPrompt(e.target.value)}>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={FREE_PROMPT_ID}>自由入力</option>
        </select>
        {isFree ? (
          <textarea
            className="free-input"
            placeholder="Claude への指示を書いてください（Cmd+Enter で実行）"
            value={freeText}
            onChange={(e) => onFreeTextChange(e.target.value)}
            rows={6}
          />
        ) : (
          prompt && <div className="prompt-body">{prompt.body}</div>
        )}
        {prompt?.model && <div className="hint">モデル: {prompt.model}</div>}
      </div>

      <div className="pane-section">
        <div className="label">
          送る内容{avail.ok && <span className="muted">（{avail.text.length.toLocaleString()}文字{file ? ` / ${file.name}` : ''}）</span>}
        </div>
        <div className="preview">
          {avail.ok ? (
            <>
              {previewLines.map((l, i) => (
                <div key={i} className="preview-line">
                  {l || ' '}
                </div>
              ))}
              {avail.text.split('\n').length > 4 && <div className="preview-line muted">…</div>}
            </>
          ) : (
            <div className="muted">—</div>
          )}
        </div>
      </div>

      <div className="pane-section speech-rate">
        <div className="label">
          読み上げ速度
          <button
            type="button"
            className="rate-value"
            title="クリックで 1.0× に戻す"
            disabled={speechRate === 1}
            onClick={() => onSpeechRateChange(1)}
          >
            {speechRate.toFixed(1)}×
          </button>
        </div>
        <input
          type="range"
          min={SPEECH_RATE.min}
          max={SPEECH_RATE.max}
          step={SPEECH_RATE.step}
          value={speechRate}
          aria-label="読み上げ速度"
          onChange={(e) => onSpeechRateChange(Number(e.target.value))}
        />
      </div>
      {speechError && <div className="pane-section hint warn speech-error">{speechError}</div>}
      <div className="pane-section run-row">
        {speaking ? (
          <button className="btn danger" onClick={onStopSpeak} title="読み上げを止める">
            停止
          </button>
        ) : (
          <button className="btn" disabled={!avail.ok} onClick={onSpeak} title="選んだ入力単位の文章を macOS の音声で読み上げる">
            読み上げ
          </button>
        )}
        {running ? (
          <button className="btn danger" onClick={onStop}>
            停止
          </button>
        ) : (
          <button className="btn primary" disabled={!canRun} onClick={onRun}>
            実行 <span className="kbd">⌘↩</span>
          </button>
        )}
      </div>
    </div>
  )
}
