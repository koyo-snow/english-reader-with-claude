// Markdown → サニタイズ済み HTML。本文ビューと AI 出力の両方で使う。
import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type StateCore, type Token } from 'markdown-it'
import DOMPurify from 'dompurify'
import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from 'shiki'

// ---------- Shiki ----------
const PRELOAD_LANGS = [
  'javascript', 'typescript', 'jsx', 'tsx', 'json', 'yaml', 'toml', 'html', 'css', 'scss',
  'bash', 'shell', 'python', 'go', 'rust', 'java', 'kotlin', 'swift', 'c', 'cpp', 'csharp',
  'ruby', 'php', 'sql', 'markdown', 'diff', 'dockerfile', 'xml', 'graphql', 'lua', 'r', 'scala', 'haskell', 'elixir'
]
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript', ts: 'typescript', sh: 'bash', zsh: 'bash', shell: 'bash', py: 'python',
  yml: 'yaml', rb: 'ruby', rs: 'rust', 'c++': 'cpp', cs: 'csharp', kt: 'kotlin', md: 'markdown',
  docker: 'dockerfile', hs: 'haskell', golang: 'go', jsonc: 'json', json5: 'json'
}

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const listeners = new Set<() => void>()
const pendingLangs = new Set<string>()

export function onHighlighterReady(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function notify(): void {
  for (const cb of listeners) cb()
}

export function ensureHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: PRELOAD_LANGS,
      engine: createJavaScriptRegexEngine({ forgiving: true })
    }).then((hl) => {
      highlighter = hl
      notify()
      return hl
    })
  }
  return highlighterPromise
}

function normalizeLang(lang: string): string {
  const l = lang.trim().toLowerCase().split(/[\s{]/)[0]
  return LANG_ALIAS[l] ?? l
}

function requestLang(lang: string): void {
  if (!highlighter || pendingLangs.has(lang)) return
  pendingLangs.add(lang)
  highlighter
    .loadLanguage(lang as never)
    .then(() => notify())
    .catch(() => {
      /* 未対応の言語はプレーン表示のまま */
    })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function highlightCode(code: string, lang: string): string {
  const l = normalizeLang(lang)
  if (l === 'mermaid') {
    return `<pre class="mermaid-block"><code>${escapeHtml(code)}</code></pre>`
  }
  const plain = `<pre class="plain"><code${l ? ` class="language-${escapeHtml(l)}"` : ''}>${escapeHtml(code)}</code></pre>`
  if (!l || !highlighter) {
    void ensureHighlighter()
    return plain
  }
  if (!highlighter.getLoadedLanguages().includes(l)) {
    requestLang(l)
    return plain
  }
  try {
    return highlighter.codeToHtml(code, {
      lang: l,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false
    })
  } catch {
    return plain
  }
}

// ---------- markdown-it ----------
const TS_RE = /\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?/g

interface Piece {
  text: string
  seconds?: number
}

/** テキストをタイムスタンプとそれ以外に分割する。 */
function splitTimestamps(text: string): Piece[] | null {
  const pieces: Piece[] = []
  let last = 0
  let found = false
  TS_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TS_RE.exec(text))) {
    const start = m.index
    const end = start + m[0].length
    const prev = start > 0 ? text[start - 1] : ''
    const next = text[end] ?? ''
    const open = m[0].startsWith('[')
    const close = m[0].endsWith(']')
    if ((prev && /[0-9A-Za-z:.\[]/.test(prev)) || /[0-9:\]]/.test(next) || open !== close) {
      TS_RE.lastIndex = start + 1
      continue
    }
    const a = Number(m[1])
    const b = Number(m[2])
    const c = m[3] === undefined ? null : Number(m[3])
    if (b > 59 || (c !== null && c > 59)) continue
    const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c
    if (start > last) pieces.push({ text: text.slice(last, start) })
    pieces.push({ text: m[0], seconds })
    last = end
    found = true
  }
  if (!found) return null
  if (last < text.length) pieces.push({ text: text.slice(last) })
  return pieces
}

function applyTimestamps(state: StateCore, inline: Token): void {
  if (!inline.children) return
  const out: Token[] = []
  let changed = false
  for (const child of inline.children) {
    if (child.type !== 'text') {
      out.push(child)
      continue
    }
    const pieces = splitTimestamps(child.content)
    if (!pieces) {
      out.push(child)
      continue
    }
    changed = true
    for (const p of pieces) {
      if (p.seconds === undefined) {
        const t = new state.Token('text', '', 0)
        t.content = p.text
        out.push(t)
      } else {
        const t = new state.Token('timestamp', '', 0)
        t.content = p.text
        t.meta = { seconds: p.seconds }
        out.push(t)
      }
    }
  }
  if (changed) inline.children = out
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'section'
}

function coreRules(state: StateCore): void {
  const tokens = state.tokens
  const used = new Map<string, number>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // 見出しに id を振る
    if (t.type === 'heading_open') {
      const inline = tokens[i + 1]
      const text = inline?.children?.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('') ?? ''
      let id = slugify(text)
      const n = used.get(id) ?? 0
      used.set(id, n + 1)
      if (n > 0) id = `${id}-${n}`
      t.attrSet('id', id)
    }
    // タスクリスト
    if (t.type === 'list_item_open') {
      const p = tokens[i + 1]
      const inline = tokens[i + 2]
      if (p?.type === 'paragraph_open' && inline?.type === 'inline' && inline.children) {
        const first = inline.children[0]
        const m = first && first.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null
        if (m) {
          first.content = first.content.slice(m[0].length)
          const box = new state.Token('html_inline', '', 0)
          box.content = `<input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `
          inline.children.unshift(box)
          t.attrJoin('class', 'task-item')
        }
      }
    }
    // タイムスタンプの分割と、タイムスタンプだけの段落
    if (t.type === 'inline' && t.children) {
      applyTimestamps(state, t)
      let hasTs = false
      let onlyTs = true
      for (const c of t.children) {
        if (c.type === 'timestamp') hasTs = true
        else if (c.type === 'softbreak' || c.type === 'hardbreak') continue
        else if (c.type === 'text' && c.content.trim() === '') continue
        else onlyTs = false
      }
      if (hasTs && onlyTs) {
        const open = tokens[i - 1]
        if (open && open.type.endsWith('_open')) open.attrJoin('class', 'ts-only')
      }
    }
  }
}

export function createMarkdown(): MarkdownItInstance {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    highlight: (code, lang) => highlightCode(code, lang)
  })
  md.core.ruler.push('reader_extras', coreRules)
  md.renderer.rules.timestamp = (tokens, idx) => {
    const t = tokens[idx]
    const seconds = (t.meta as { seconds?: number } | null)?.seconds ?? 0
    return `<a class="ts" href="#" data-s="${seconds}">${escapeHtml(t.content)}</a>`
  }
  md.renderer.rules.fence = (tokens, idx, options) => {
    const t = tokens[idx]
    const info = t.info ? md.utils.unescapeAll(t.info).trim() : ''
    const lang = info.split(/\s+/)[0] ?? ''
    return options.highlight?.(t.content, lang, '') ?? `<pre><code>${escapeHtml(t.content)}</code></pre>`
  }
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener')
    return defaultLink(tokens, idx, options, env, self)
  }
  return md
}

const md = createMarkdown()

export function renderMarkdown(src: string): string {
  const html = md.render(src)
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'data-s', 'data-src'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form']
  })
}

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'style'],
    FORBID_TAGS: ['script']
  })
}
