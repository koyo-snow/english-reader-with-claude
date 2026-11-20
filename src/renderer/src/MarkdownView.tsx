// サニタイズ済み HTML を描画し、Mermaid 図・外部リンク・タイムスタンプのクリックを扱う。
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { onHighlighterReady, renderMarkdown, sanitizeSvg } from './markdown'

let mermaidTheme: 'default' | 'dark' | null = null
function initMermaid(dark: boolean): void {
  const theme = dark ? 'dark' : 'default'
  if (mermaidTheme === theme) return
  mermaidTheme = theme
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit' })
}

let mermaidSeq = 0

async function renderMermaidBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLPreElement>('pre.mermaid-block:not([data-rendered])'))
  if (blocks.length === 0) return
  initMermaid(dark)
  for (const pre of blocks) {
    const src = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
    pre.dataset.rendered = '1'
    const wrap = document.createElement('div')
    wrap.className = 'mermaid-figure'
    try {
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, src)
      wrap.innerHTML = sanitizeSvg(svg)
      pre.replaceWith(wrap)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      wrap.className = 'mermaid-error'
      const p = document.createElement('p')
      p.textContent = `Mermaid の描画に失敗しました: ${msg}`
      const code = document.createElement('pre')
      code.textContent = src
      wrap.append(p, code)
      pre.replaceWith(wrap)
    }
  }
}

export interface MarkdownViewHandle {
  element: HTMLDivElement | null
}

interface Props {
  markdown: string
  dark: boolean
  className?: string
  onTimestampClick?: (seconds: number) => void
  onRendered?: () => void
}

export const MarkdownView = forwardRef<MarkdownViewHandle, Props>(function MarkdownView(
  { markdown, dark, className, onTimestampClick, onRendered },
  ref
) {
  const el = useRef<HTMLDivElement>(null)
  const [hlVersion, setHlVersion] = useState(0)
  useImperativeHandle(ref, () => ({ get element() { return el.current } }), [])

  useEffect(() => onHighlighterReady(() => setHlVersion((v) => v + 1)), [])

  const html = useMemo(() => renderMarkdown(markdown), [markdown, hlVersion])

  useLayoutEffect(() => {
    const root = el.current
    if (!root) return
    root.innerHTML = html
    onRendered?.()
    void renderMermaidBlocks(root, dark)
  }, [html, dark, onRendered])

  useEffect(() => {
    const root = el.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      if (a.classList.contains('ts')) {
        e.preventDefault()
        const s = Number(a.dataset.s)
        if (Number.isFinite(s)) onTimestampClick?.(s)
        return
      }
      const href = a.getAttribute('href') ?? ''
      e.preventDefault()
      if (/^https?:\/\//.test(href)) void window.api.shell.openExternal(href)
      else if (href.startsWith('#')) {
        const target = root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
        target?.scrollIntoView({ block: 'start' })
      }
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [onTimestampClick])

  return <div ref={el} className={`markdown-body ${className ?? ''}`} />
})
