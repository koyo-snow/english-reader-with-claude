// 設定タブ：中央ペインに表示。変更は即時反映・自動保存。
import { useEffect, useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ClaudeInfo, InputUnit, ModelName, PromptDef, Settings } from '@shared/types'
import { DEFAULT_PROMPTS, DEFAULT_SYSTEM_PROMPT, INPUT_UNIT_LABELS } from '@shared/types'
import { newId } from '../conversation'

interface Props {
  settings: Settings
  onChange: (next: Settings) => void
  claudeInfo: ClaudeInfo | null
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="settings-row">
      <div className="settings-label">{label}</div>
      <div className="settings-control">
        {children}
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  )
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

function SortablePrompt({ p, selected, onSelect }: { p: PromptDef; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
  return (
    <div ref={setNodeRef} style={style} className={`prompt-item ${selected ? 'active' : ''}`} onClick={onSelect}>
      <span className="drag-handle" {...attributes} {...listeners} title="ドラッグで並べ替え">
        ⋮⋮
      </span>
      <span className="prompt-item-name">{p.name || '（無題）'}</span>
      <span className="muted small-text">{INPUT_UNIT_LABELS[p.defaultInput]}</span>
    </div>
  )
}

export function SettingsTab({ settings, onChange, claudeInfo }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(settings.prompts[0]?.id ?? null)
  const selected = settings.prompts.find((p) => p.id === selectedId) ?? null
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value })
  const setReader = (patch: Partial<Settings['reader']>) => set('reader', { ...settings.reader, ...patch })
  const setAi = (patch: Partial<Settings['ai']>) => set('ai', { ...settings.ai, ...patch })
  const setSave = (patch: Partial<Settings['save']>) => set('save', { ...settings.save, ...patch })
  const setPrompts = (prompts: PromptDef[]) => set('prompts', prompts)
  const updatePrompt = (id: string, patch: Partial<PromptDef>) => setPrompts(settings.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = settings.prompts.findIndex((p) => p.id === active.id)
    const to = settings.prompts.findIndex((p) => p.id === over.id)
    setPrompts(arrayMove(settings.prompts, from, to))
  }

  const addPrompt = () => {
    const p: PromptDef = { id: newId(), name: '新しいプロンプト', body: '', defaultInput: 'selection', model: null, showInContextMenu: true }
    setPrompts([...settings.prompts, p])
    setSelectedId(p.id)
  }
  const duplicatePrompt = () => {
    if (!selected) return
    const idx = settings.prompts.findIndex((p) => p.id === selected.id)
    const copy: PromptDef = { ...selected, id: newId(), name: `${selected.name} のコピー` }
    const next = [...settings.prompts]
    next.splice(idx + 1, 0, copy)
    setPrompts(next)
    setSelectedId(copy.id)
  }
  const deletePrompt = () => {
    if (!selected) return
    if (!window.confirm(`「${selected.name}」を削除しますか？`)) return
    const next = settings.prompts.filter((p) => p.id !== selected.id)
    setPrompts(next)
    setSelectedId(next[0]?.id ?? null)
  }
  const resetPrompts = () => {
    if (!window.confirm('プロンプト一覧を初期状態に戻しますか？現在の一覧は失われます。')) return
    const defaults = structuredClone(DEFAULT_PROMPTS)
    setPrompts(defaults)
    setSelectedId(defaults[0].id)
  }

  return (
    <div className="settings">
      <h2>一般</h2>
      <Row label="Vault パス" hint="Obsidian Vault のフォルダ。起動時に前回の Vault を開きます。">
        <div className="inline">
          <input type="text" value={settings.vaultPath} onChange={(e) => set('vaultPath', e.target.value)} placeholder="/Users/you/Obsidian/MyVault" />
          <button
            className="btn"
            onClick={async () => {
              const p = await window.api.settings.chooseFolder()
              if (p) set('vaultPath', p)
            }}
          >
            選択…
          </button>
        </div>
      </Row>
      <Row label="テーマ">
        <select value={settings.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
          <option value="system">システム連動</option>
          <option value="light">ライト</option>
          <option value="dark">ダーク</option>
        </select>
      </Row>
      <Row label="応答言語">
        <select value={settings.ai.responseLanguage} onChange={(e) => setAi({ responseLanguage: e.target.value as 'ja' | 'en' })}>
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </Row>

      <h2>本文表示</h2>
      <Row label="本文フォント">
        <input type="text" value={settings.reader.fontFamily} onChange={(e) => setReader({ fontFamily: e.target.value })} />
      </Row>
      <Row label="コードフォント">
        <input type="text" value={settings.reader.codeFontFamily} onChange={(e) => setReader({ codeFontFamily: e.target.value })} />
      </Row>
      <Row label="文字サイズ (px)">
        <NumberInput value={settings.reader.fontSize} min={10} max={40} onChange={(v) => setReader({ fontSize: v })} />
      </Row>
      <Row label="行間">
        <NumberInput value={settings.reader.lineHeight} min={1} max={3} step={0.05} onChange={(v) => setReader({ lineHeight: v })} />
      </Row>
      <Row label="行幅 (ch)">
        <NumberInput value={settings.reader.maxLineWidthCh} min={30} max={200} onChange={(v) => setReader({ maxLineWidthCh: v })} />
      </Row>
      <Row label="タイムスタンプの初期表示">
        <label className="check">
          <input type="checkbox" checked={settings.reader.showTimestamps} onChange={(e) => setReader({ showTimestamps: e.target.checked })} /> ファイルを開いたときに表示する
        </label>
      </Row>
      <Row label="動画 URL の frontmatter キー" hint="カンマ区切り。タイムスタンプのクリックでこの URL を該当時刻で開きます。">
        <input
          type="text"
          value={settings.reader.videoUrlKeys.join(', ')}
          onChange={(e) =>
            setReader({
              videoUrlKeys: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            })
          }
        />
      </Row>

      <h2>AI</h2>
      <Row
        label="claude のパス"
        hint={
          claudeInfo
            ? claudeInfo.source === 'settings'
              ? `設定のパスを使用: ${claudeInfo.resolvedPath}`
              : claudeInfo.source === 'detected'
                ? `自動検出: ${claudeInfo.resolvedPath}`
                : 'インストール済みの claude が見つからないため、SDK 同梱のバイナリを使います。ログイン情報は共有されます。'
            : ''
        }
      >
        <div className="inline">
          <input type="text" value={settings.ai.claudePath} onChange={(e) => setAi({ claudePath: e.target.value })} placeholder="空欄で自動検出" />
          <button
            className="btn"
            onClick={async () => {
              const p = await window.api.settings.chooseFile()
              if (p) setAi({ claudePath: p })
            }}
          >
            選択…
          </button>
        </div>
      </Row>
      <Row label="既定モデル">
        <select value={settings.ai.defaultModel} onChange={(e) => setAi({ defaultModel: e.target.value as ModelName })}>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>
      </Row>
      <Row label="ファイル全体の文字数上限" hint="frontmatter を除いた本文の文字数（空白・改行を含む）">
        <NumberInput value={settings.ai.wholeFileCharLimit} min={100} max={1000000} step={100} onChange={(v) => setAi({ wholeFileCharLimit: v })} />
      </Row>
      <Row label="システムプロンプト">
        <textarea rows={4} value={settings.ai.systemPrompt} onChange={(e) => setAi({ systemPrompt: e.target.value })} />
        <button className="link" onClick={() => setAi({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>
          既定に戻す
        </button>
      </Row>

      <h2>保存</h2>
      <Row label="保存先フォルダ" hint="Vault からの相対パス。存在しなければ作成します。">
        <input type="text" value={settings.save.folder} onChange={(e) => setSave({ folder: e.target.value })} />
      </Row>
      <Row label="保存範囲">
        <select value={settings.save.scope} onChange={(e) => setSave({ scope: e.target.value as 'conversation' | 'latest' })}>
          <option value="conversation">会話全体</option>
          <option value="latest">最新の回答のみ</option>
        </select>
      </Row>

      <h2>プロンプト</h2>
      <div className="prompt-editor">
        <div className="prompt-list">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={settings.prompts.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {settings.prompts.map((p) => (
                <SortablePrompt key={p.id} p={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
              ))}
            </SortableContext>
          </DndContext>
          <div className="prompt-list-actions">
            <button className="btn" onClick={addPrompt}>
              追加
            </button>
            <button className="btn" disabled={!selected} onClick={duplicatePrompt}>
              複製
            </button>
            <button className="btn" disabled={!selected} onClick={deletePrompt}>
              削除
            </button>
            <span className="toolbar-spacer" />
            <button className="btn" onClick={resetPrompts}>
              初期プロンプトに戻す
            </button>
          </div>
        </div>
        <div className="prompt-form">
          {selected ? (
            <>
              <Row label="名前">
                <input type="text" value={selected.name} onChange={(e) => updatePrompt(selected.id, { name: e.target.value })} />
              </Row>
              <Row label="本文">
                <textarea rows={6} value={selected.body} onChange={(e) => updatePrompt(selected.id, { body: e.target.value })} />
              </Row>
              <Row label="既定の入力単位">
                <select value={selected.defaultInput} onChange={(e) => updatePrompt(selected.id, { defaultInput: e.target.value as InputUnit })}>
                  {(['selection', 'paragraph', 'wholeFile'] as InputUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {INPUT_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="モデル">
                <select value={selected.model ?? ''} onChange={(e) => updatePrompt(selected.id, { model: (e.target.value || null) as ModelName | null })}>
                  <option value="">既定（{settings.ai.defaultModel}）</option>
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                </select>
              </Row>
              <Row label="右クリックメニュー">
                <label className="check">
                  <input type="checkbox" checked={selected.showInContextMenu} onChange={(e) => updatePrompt(selected.id, { showInContextMenu: e.target.checked })} /> 表示する
                </label>
              </Row>
            </>
          ) : (
            <div className="muted">プロンプトを選択してください</div>
          )}
        </div>
      </div>
      <div className="settings-footer muted small-text">設定は自動保存されます。</div>
    </div>
  )
}
