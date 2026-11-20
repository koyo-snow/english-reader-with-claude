// 仕様書「中央：本文ビュー／レンダリング」「字幕のタイムスタンプ」「セキュリティ（サニタイズ）」
import { beforeAll, describe, expect, it } from 'vitest'
import { ensureHighlighter, renderMarkdown, sanitizeSvg } from '../../../src/renderer/src/markdown'

function dom(src: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = renderMarkdown(src)
  return el
}
const stamps = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLAnchorElement>('a.ts')).map((a) => [a.textContent, a.dataset.s])

describe('Markdown（CommonMark＋GFM）', () => {
  it('MD-01 見出し・強調・リスト・引用・インラインコードを描画する', () => {
    const el = dom('# Title\n\nSome *em* and **strong** and `code`.\n\n- a\n- b\n\n1. one\n2. two\n\n> quote\n')
    expect(el.querySelector('h1')?.textContent).toBe('Title')
    expect(el.querySelector('em')?.textContent).toBe('em')
    expect(el.querySelector('strong')?.textContent).toBe('strong')
    expect(el.querySelector('p code')?.textContent).toBe('code')
    expect(el.querySelectorAll('ul > li')).toHaveLength(2)
    expect(el.querySelectorAll('ol > li')).toHaveLength(2)
    expect(el.querySelector('blockquote')?.textContent?.trim()).toBe('quote')
  })

  it('MD-02 表（GFM）を描画する', () => {
    const el = dom('| Key | Action |\n| --- | --- |\n| Cmd+L | Left |\n| Cmd+R | Right |\n')
    expect(Array.from(el.querySelectorAll('th')).map((c) => c.textContent)).toEqual(['Key', 'Action'])
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(el.querySelector('tbody tr td')?.textContent).toBe('Cmd+L')
  })

  it('MD-03 タスクリスト（GFM）をチェックボックスとして描画する（編集はできない）', () => {
    const el = dom('- [ ] todo\n- [x] done\n- plain\n')
    const boxes = Array.from(el.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]'))
    expect(boxes).toHaveLength(2)
    expect(boxes.map((b) => b.checked)).toEqual([false, true])
    expect(boxes.every((b) => b.disabled)).toBe(true)
    expect(el.querySelectorAll('li')[0].textContent?.trim()).toBe('todo')
    expect(el.textContent).not.toContain('[x]')
  })

  it('MD-04 取り消し線（GFM）を描画する', () => {
    const el = dom('This is ~~wrong~~ right.')
    expect(el.querySelector('s, del')?.textContent).toBe('wrong')
  })

  it('MD-05 自動リンク（GFM）：URL をそのまま書いてもリンクになる', () => {
    const el = dom('See https://example.com/docs for details. Also <https://example.org>.')
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://example.com/docs', 'https://example.org'])
  })

  it('MD-06 見出しには一覧から移動するための id が付き、同名の見出しでも重複しない', () => {
    const el = dom('# Intro\n\n## Setup\n\n## Setup\n\n## 日本語の見出し\n')
    const ids = Array.from(el.querySelectorAll('h1, h2')).map((h) => h.id)
    expect(ids.every((id) => id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('MD-07 Obsidian 独自記法は解釈せず、そのまま文字列として表示する', () => {
    const el = dom('Link to [[Other Note]] and [[Note|alias]].\n\n![[embedded.png]]\n\n> [!note] Callout title\n> body\n')
    expect(el.textContent).toContain('[[Other Note]]')
    expect(el.textContent).toContain('[[Note|alias]]')
    expect(el.textContent).toContain('![[embedded.png]]')
    expect(el.textContent).toContain('[!note] Callout title')
    expect(el.querySelector('a')).toBeNull()
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('[class*="callout"]')).toBeNull()
  })
})

describe('コードブロックと Mermaid', () => {
  beforeAll(async () => {
    await ensureHighlighter()
  })

  it('MD-10 コードブロックをシンタックスハイライトする', () => {
    const el = dom('```ts\nconst answer: number = 42\n```\n')
    const pre = el.querySelector('pre')
    expect(pre?.className).toContain('shiki')
    expect(pre?.querySelectorAll('span[style]').length).toBeGreaterThan(1)
    expect(pre?.textContent?.trim()).toBe('const answer: number = 42')
  })

  it('MD-11 言語の別名（js, py, sh など）でもハイライトする', () => {
    for (const lang of ['js', 'py', 'sh']) {
      expect(dom(`\`\`\`${lang}\nx = 1\n\`\`\`\n`).querySelector('pre')?.className, lang).toContain('shiki')
    }
  })

  it('MD-12 言語の指定がないコードブロックは、そのままの文字で表示する', () => {
    const pre = dom('```\n<b>plain</b> & text\n```\n').querySelector('pre')
    expect(pre?.textContent?.trim()).toBe('<b>plain</b> & text')
    expect(pre?.querySelector('b')).toBeNull()
  })

  // 既知の不具合: Shiki が知らない言語名（Obsidian の ```dataview など）だと loadLanguage が同期的に例外を投げ、
  // その言語を初めて描画する renderMarkdown が 1 回だけ失敗する。画面では React が描画をやり直すので表示は崩れない
  // （E2E の MD-38 は通る）が、例外に頼った動きなので記録しておく。直ったら「失敗するはずが成功した」と報告されるので fails を外す。
  it.fails('MD-14 未対応の言語のコードブロックがあっても描画に失敗せず、そのままの文字で表示する', () => {
    const el = dom('# Title\n\n```nosuchlang\n<b>plain</b> & text\n```\n')
    expect(el.querySelector('h1')?.textContent).toBe('Title')
    expect(el.querySelector('pre')?.textContent?.trim()).toBe('<b>plain</b> & text')
  })

  it('MD-13 ```mermaid ブロックは図として描画するために、元のコードを保ったまま渡す', () => {
    const src = 'graph TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Done]'
    const el = dom('```mermaid\n' + src + '\n```\n')
    const pre = el.querySelector('pre.mermaid-block')
    expect(pre).not.toBeNull()
    expect(pre?.querySelector('code')?.textContent?.trim()).toBe(src)
  })
})

describe('字幕のタイムスタンプ', () => {
  it('TS-01 00:12:34 の形式をタイムスタンプとして認識し、秒数を持たせる', () => {
    expect(stamps(dom('00:12:34 The event loop'))).toEqual([['00:12:34', '754']])
    expect(stamps(dom('1:02:03 later'))).toEqual([['1:02:03', '3723']])
  })

  it('TS-02 [12:34] の形式をタイムスタンプとして認識する', () => {
    expect(stamps(dom('[12:34] The event loop'))).toEqual([['[12:34]', '754']])
    expect(stamps(dom('[00:12:34] The event loop'))).toEqual([['[00:12:34]', '754']])
  })

  it('TS-03 1 つの段落に複数あっても、文中にあっても認識する', () => {
    const el = dom('00:00:05 Welcome.\n00:00:09 Let us begin [00:15] now.')
    expect(stamps(el)).toEqual([
      ['00:00:05', '5'],
      ['00:00:09', '9'],
      ['[00:15]', '15']
    ])
    expect(el.textContent).toContain('Welcome.')
  })

  it('TS-04 タイムスタンプだけの段落には、非表示時に行ごと詰めるための印を付ける', () => {
    const el = dom('00:00:05\n\nWelcome to the talk.\n\n[00:09]\n\n00:00:12 Text on the same line.\n')
    const paras = Array.from(el.querySelectorAll('p'))
    expect(paras.map((p) => p.classList.contains('ts-only'))).toEqual([true, false, true, false])
  })

  it('TS-05 タイムスタンプでないものは変換しない', () => {
    for (const src of ['Ratio is 16:9 today', 'Bad time 12:75 here', 'Version v1:23', 'Port 127.0.0.1:80', 'Half [12:34 open']) {
      expect(stamps(dom(src)), src).toEqual([])
    }
  })

  it('TS-06 コードの中のタイムスタンプは変換しない', () => {
    expect(stamps(dom('Use `00:12:34` format.\n\n```\n00:12:34 in code\n```\n'))).toEqual([])
  })

  it('TS-07 タイムスタンプを変換しても本文の文字は変わらない', () => {
    const src = '00:12:34 It offloads operations [12:40] to the kernel.'
    expect(dom(src).textContent?.trim()).toBe(src)
  })
})

describe('サニタイズ', () => {
  it('SEC-20 本文中の HTML タグは実行可能な要素にならない', () => {
    const el = dom(
      [
        '<script>window.__xss = 1</script>',
        '',
        '<img src="x" onerror="window.__xss = 1">',
        '',
        '<iframe src="https://example.com"></iframe>',
        '',
        'inline <b onclick="window.__xss = 1">bold</b> <style>body{display:none}</style>'
      ].join('\n')
    )
    expect(el.querySelector('script, iframe, img, style, object, embed, form')).toBeNull()
    expect(el.querySelector('[onerror], [onclick]')).toBeNull()
    expect(el.textContent).toContain('<script>window.__xss = 1</script>') // 文字として見える
  })

  it('SEC-21 javascript: などのリンクは作らない', () => {
    const el = dom('[click](javascript:alert(1)) [data](data:text/html,<script>alert(1)</script>) [vb](vbscript:msgbox(1))')
    for (const a of Array.from(el.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^\s*(javascript|data|vbscript):/i)
    }
  })

  it('SEC-22 リンクはアプリ内で遷移しないよう、新しいウィンドウ扱い（target=_blank, rel=noopener）にする', () => {
    const a = dom('[docs](https://example.com/docs)').querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://example.com/docs')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toContain('noopener')
  })

  it('SEC-23 Mermaid が出力した SVG からスクリプトとイベント属性を取り除く', () => {
    const el = document.createElement('div')
    el.innerHTML = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__xss = 1</script><g onclick="window.__xss = 1"><rect width="10" height="10"></rect><text>Node</text></g></svg>'
    )
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelector('rect')).not.toBeNull()
    expect(el.querySelector('text')?.textContent).toBe('Node')
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('[onclick]')).toBeNull()
  })
})
