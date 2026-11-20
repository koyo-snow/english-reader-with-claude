// 中央：本文ビュー。ツールバー、検索、アウトライン、ハイライト、右クリックメニューを含む。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileContent, InputUnit, PromptDef, Settings, Theme } from '@shared/types'
import { MarkdownView, type MarkdownViewHandle } from '../MarkdownView'
import { findRanges, setHighlight } from '../textRanges'

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, .mermaid-figure'

interface Props {
  file: FileContent | null
  fileMissing: boolean
  reader: Settings['reader']
  theme: Theme
  dark: boolean
  showTimestamps: boolean
  onToggleTimestamps: () => void
  highlights: string[]
  onAddHighlight: (text: string) => void
  onRemoveHighlight: (text: string) => void
  prompts: PromptDef[]
  onRunPrompt: (prompt: PromptDef, unit: InputUnit, text: string) => void
  onSelectionChange: (text: string) => void
  onParagraphChange: (text: string) => void
  searchOpen: boolean
  onCloseSearch: () => void
  initialScroll: number
  onScroll: (pos: number) => void
  onUpdateReader: (patch: Partial<Settings['reader']>) => void
  onUpdateTheme: (theme: Theme) => void
  reloadKey: number
}

interface Heading {
  id: string
  level: number
  text: string
}

interface MenuState {
  x: number
  y: number
  selection: string
  paragraph: string
}

function videoUrlWithTime(fm: Record<string, unknown>, keys: string[], seconds: number): string | null {
  for (const k of keys) {
    const v = fm[k]
    if (typeof v !== 'string' || !/^https?:\/\//.test(v)) continue
    try {
      const u = new URL(v)
      if (u.hostname.includes('youtube.com') || u.hostname === 'youtu.be') {
        u.searchParams.set('t', `${Math.floor(seconds)}s`)
      } else {
        u.searchParams.set('t', String(Math.floor(seconds)))
      }
      return u.toString()
    } catch {
      continue
    }
  }
  return null
}

export function Reader(props: Props) {
  const {
    file, fileMissing, reader, theme, dark, showTimestamps, onToggleTimestamps, highlights,
    onAddHighlight, onRemoveHighlight, prompts, onRunPrompt, onSelectionChange, onParagraphChange,
    searchOpen, onCloseSearch, initialScroll, onScroll, onUpdateReader, onUpdateTheme, reloadKey
  } = props

  const scrollRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MarkdownViewHandle>(null)
  const [progress, setProgress] = useState(0)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Range[]>([])
  const [matchIdx, setMatchIdx] = useState(0)
  const [renderTick, setRenderTick] = useState(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const activePara = useRef<HTMLElement | null>(null)
  const pendingScroll = useRef<number | null>(null)
  const lastPath = useRef<string | null>(null)

  // ファイルが切り替わったら読書位置の復元を予約
  useEffect(() => {
    if (file && file.path !== lastPath.current) {
      lastPath.current = file.path
      pendingScroll.current = initialScroll
      activePara.current = null
      onParagraphChange('')
      onSelectionChange('')
    }
    if (!file) lastPath.current = null
  }, [file, initialScroll, onParagraphChange, onSelectionChange])

  const onRendered = useCallback(() => {
    setRenderTick((t) => t + 1)
  }, [])

  // レンダリング後：スクロール位置復元、アウトライン更新
  useLayoutEffect(() => {
    const sc = scrollRef.current
    const root = viewRef.current?.element
    if (!sc || !root) return
    if (pendingScroll.current !== null) {
      sc.scrollTop = pendingScroll.current
      pendingScroll.current = null
    }
    const hs = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).map((h) => ({
      id: h.id,
      level: Number(h.tagName[1]),
      text: h.textContent ?? ''
    }))
    setHeadings(hs)
  }, [renderTick, reloadKey])

  // 外部変更で再読み込みしたときはスクロール位置を保つ
  useEffect(() => {
    const sc = scrollRef.current
    if (sc && file) pendingScroll.current = sc.scrollTop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  // 進捗とスクロール位置の保存
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let timer: number | null = null
    const handler = () => {
      const max = sc.scrollHeight - sc.clientHeight
      setProgress(max <= 0 ? 100 : Math.min(100, Math.round((sc.scrollTop / max) * 100)))
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => onScroll(sc.scrollTop), 400)
    }
    sc.addEventListener('scroll', handler)
    handler()
    return () => {
      sc.removeEventListener('scroll', handler)
      if (timer) window.clearTimeout(timer)
    }
  }, [onScroll, renderTick])

  // マーカー（ハイライト）
  useEffect(() => {
    const root = viewRef.current?.element
    if (!root) return
    setHighlight('user-marks', highlights.length ? findRanges(root, highlights) : [])
  }, [highlights, renderTick, showTimestamps])

  // 検索（遅延実行）
  useEffect(() => {
    const root = viewRef.current?.element
    if (!root || !searchOpen || !query.trim()) {
      setMatches([])
      setHighlight('search', [])
      setHighlight('search-current', [])
      return
    }
    const t = window.setTimeout(() => {
      const r = findRanges(root, [query], { limit: 2000 })
      setMatches(r)
      setMatchIdx(0)
    }, 150)
    return () => window.clearTimeout(t)
  }, [query, searchOpen, renderTick, showTimestamps])

  useEffect(() => {
    setHighlight('search', matches)
    const cur = matches[matchIdx]
    setHighlight('search-current', cur ? [cur] : [])
    if (cur) {
      const rect = cur.getBoundingClientRect()
      const sc = scrollRef.current
      if (sc) {
        const scRect = sc.getBoundingClientRect()
        if (rect.top < scRect.top + 40 || rect.bottom > scRect.bottom - 40) {
          sc.scrollTop += rect.top - scRect.top - sc.clientHeight / 3
        }
      }
    }
  }, [matches, matchIdx])

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
    else {
      setHighlight('search', [])
      setHighlight('search-current', [])
    }
  }, [searchOpen])

  // 選択範囲と段落の追跡
  const readSelection = useCallback((): string => {
    const sel = document.getSelection()
    const root = viewRef.current?.element
    if (!sel || sel.isCollapsed || !root) return ''
    if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return ''
    return sel.toString().trim()
  }, [])

  const setActivePara = useCallback(
    (el: HTMLElement | null) => {
      activePara.current?.classList.remove('active-para')
      activePara.current = el
      if (el) {
        el.classList.add('active-para')
        onParagraphChange(el.innerText.trim())
      } else onParagraphChange('')
    },
    [onParagraphChange]
  )

  useEffect(() => {
    const root = viewRef.current?.element
    if (!root) return
    const onMouseUp = () => {
      const text = readSelection()
      onSelectionChange(text)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const el = (e.target as HTMLElement).closest<HTMLElement>(BLOCK_SELECTOR)
      if (el && root.contains(el)) setActivePara(el)
    }
    root.addEventListener('mouseup', onMouseUp)
    root.addEventListener('mousedown', onMouseDown)
    const onSelChange = () => {
      const text = readSelection()
      if (text) onSelectionChange(text)
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => {
      root.removeEventListener('mouseup', onMouseUp)
      root.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('selectionchange', onSelChange)
    }
  }, [readSelection, onSelectionChange, setActivePara, renderTick])

  // 右クリックメニュー
  useEffect(() => {
    const root = viewRef.current?.element
    if (!root) return
    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      const el = (e.target as HTMLElement).closest<HTMLElement>(BLOCK_SELECTOR)
      if (el && root.contains(el)) setActivePara(el)
      setMenu({ x: e.clientX, y: e.clientY, selection: readSelection(), paragraph: el?.innerText.trim() ?? '' })
    }
    root.addEventListener('contextmenu', onCtx)
    return () => root.removeEventListener('contextmenu', onCtx)
  }, [readSelection, setActivePara, renderTick])

  useEffect(() => {
    if (!menu && !outlineOpen && !quickOpen) return
    const close = () => {
      setMenu(null)
      setOutlineOpen(false)
      setQuickOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu, outlineOpen, quickOpen])

  const onTimestampClick = useCallback(
    (seconds: number) => {
      if (!file) return
      const url = videoUrlWithTime(file.frontmatter, reader.videoUrlKeys, seconds)
      if (url) void window.api.shell.openExternal(url)
    },
    [file, reader.videoUrlKeys]
  )

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (matches.length === 0) return
      setMatchIdx((i) => (e.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length))
    } else if (e.key === 'Escape') {
      onCloseSearch()
    }
  }

  const title = useMemo(() => {
    if (!file) return ''
    const t = file.frontmatter.title
    return typeof t === 'string' && t.trim() ? t : file.name.replace(/\.md$/i, '')
  }, [file])

  const menuPrompts = prompts.filter((p) => p.showInContextMenu)
  const bodyStyle = {
    '--reader-font': reader.fontFamily ? `"${reader.fontFamily}", system-ui, sans-serif` : 'system-ui, sans-serif',
    '--code-font': reader.codeFontFamily ? `"${reader.codeFontFamily}", ui-monospace, monospace` : 'ui-monospace, monospace',
    '--reader-size': `${reader.fontSize}px`,
    '--reader-lh': String(reader.lineHeight),
    '--reader-width': `${reader.maxLineWidthCh}ch`
  } as React.CSSProperties

  return (
    <div className="reader" style={bodyStyle}>
      <div className="toolbar">
        <div className="toolbar-title" title={file?.path ?? ''}>
          {file ? title : 'ファイルを選択してください'}
        </div>
        <div className="toolbar-spacer" />
        {file && <span className="toolbar-progress">{progress}%</span>}
        <button
          className={`tb-btn ${showTimestamps ? '' : 'active'}`}
          title={showTimestamps ? 'タイムスタンプを隠す' : 'タイムスタンプを表示'}
          onClick={onToggleTimestamps}
        >
          ⏱
        </button>
        <div className="popover-anchor">
          <button className="tb-btn" title="見出し一覧" onMouseDown={(e) => e.stopPropagation()} onClick={() => { setOutlineOpen((v) => !v); setQuickOpen(false) }}>
            ☰
          </button>
          {outlineOpen && (
            <div className="popover outline" onMouseDown={(e) => e.stopPropagation()}>
              {headings.length === 0 ? (
                <div className="popover-empty">見出しがありません</div>
              ) : (
                headings.map((h, i) => (
                  <div
                    key={`${h.id}-${i}`}
                    className="outline-item"
                    style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                    onClick={() => {
                      const root = viewRef.current?.element
                      const el = root?.querySelector<HTMLElement>(`[id="${CSS.escape(h.id)}"]`)
                      el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                      setOutlineOpen(false)
                    }}
                  >
                    {h.text}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="popover-anchor">
          <button className="tb-btn" title="表示設定" onMouseDown={(e) => e.stopPropagation()} onClick={() => { setQuickOpen((v) => !v); setOutlineOpen(false) }}>
            Aa
          </button>
          {quickOpen && (
            <div className="popover quick" onMouseDown={(e) => e.stopPropagation()}>
              <label>
                文字サイズ
                <input type="range" min={12} max={28} step={1} value={reader.fontSize} onChange={(e) => onUpdateReader({ fontSize: Number(e.target.value) })} />
                <span>{reader.fontSize}px</span>
              </label>
              <label>
                行間
                <input type="range" min={1.2} max={2.4} step={0.05} value={reader.lineHeight} onChange={(e) => onUpdateReader({ lineHeight: Number(e.target.value) })} />
                <span>{reader.lineHeight.toFixed(2)}</span>
              </label>
              <label>
                行幅
                <input type="range" min={40} max={140} step={2} value={reader.maxLineWidthCh} onChange={(e) => onUpdateReader({ maxLineWidthCh: Number(e.target.value) })} />
                <span>{reader.maxLineWidthCh}ch</span>
              </label>
              <label>
                テーマ
                <select value={theme} onChange={(e) => onUpdateTheme(e.target.value as Theme)}>
                  <option value="system">システム</option>
                  <option value="light">ライト</option>
                  <option value="dark">ダーク</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchInput}
            type="search"
            placeholder="ファイル内検索（Enter: 次へ / Shift+Enter: 前へ）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <span className="search-count">{matches.length ? `${matchIdx + 1} / ${matches.length}` : query ? '0 件' : ''}</span>
          <button className="tb-btn" onClick={() => setMatchIdx((i) => (i - 1 + matches.length) % Math.max(1, matches.length))} title="前へ">▲</button>
          <button className="tb-btn" onClick={() => setMatchIdx((i) => (i + 1) % Math.max(1, matches.length))} title="次へ">▼</button>
          <button className="tb-btn" onClick={onCloseSearch} title="閉じる">✕</button>
        </div>
      )}

      <div ref={scrollRef} className={`reader-scroll ${showTimestamps ? '' : 'ts-hidden'}`}>
        {fileMissing ? (
          <div className="reader-empty">このファイルは削除または移動されました。</div>
        ) : !file ? (
          <div className="reader-empty">左のツリーからファイルを選ぶと、ここに本文が表示されます。</div>
        ) : (
          <MarkdownView
            key={file.path}
            ref={viewRef}
            markdown={file.body}
            dark={dark}
            className="reader-body"
            onTimestampClick={onTimestampClick}
            onRendered={onRendered}
          />
        )}
      </div>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menuPrompts.map((p) => {
            const unit: InputUnit = menu.selection ? 'selection' : 'paragraph'
            const text = menu.selection || menu.paragraph
            return (
              <div
                key={p.id}
                className={`menu-item ${text ? '' : 'disabled'}`}
                onClick={() => {
                  if (!text) return
                  setMenu(null)
                  onRunPrompt(p, unit, text)
                }}
              >
                {p.name}
                <span className="menu-hint">{menu.selection ? '選択範囲' : '段落'}</span>
              </div>
            )
          })}
          {menuPrompts.length > 0 && <div className="menu-sep" />}
          <div
            className={`menu-item ${menu.selection || menu.paragraph ? '' : 'disabled'}`}
            onClick={() => {
              const t = menu.selection || menu.paragraph
              if (t) void navigator.clipboard.writeText(t)
              setMenu(null)
            }}
          >
            コピー
          </div>
          <div
            className={`menu-item ${menu.selection ? '' : 'disabled'}`}
            onClick={() => {
              if (menu.selection) onAddHighlight(menu.selection)
              setMenu(null)
            }}
          >
            ハイライト
          </div>
          <div
            className={`menu-item ${menu.selection && highlights.some((h) => menu.selection.includes(h) || h.includes(menu.selection)) ? '' : 'disabled'}`}
            onClick={() => {
              for (const h of highlights) {
                if (menu.selection.includes(h) || h.includes(menu.selection)) onRemoveHighlight(h)
              }
              setMenu(null)
            }}
          >
            ハイライト解除
          </div>
        </div>
      )}
    </div>
  )
}
