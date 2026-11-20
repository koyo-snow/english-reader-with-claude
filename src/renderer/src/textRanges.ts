// DOM のテキストノードを横断して文字列を検索し、Range の配列を返す。検索ハイライトとマーカーで使う。

interface TextRun {
  node: Text
  start: number // 連結テキスト上の開始位置
}

function collectText(root: HTMLElement): { text: string; runs: TextRun[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      // 非表示のタイムスタンプ要素は対象外
      if (parent.closest('script, style')) return NodeFilter.FILTER_REJECT
      const ts = parent.closest('.ts, .ts-only')
      if (ts && ts.closest('.ts-hidden')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const runs: TextRun[] = []
  let text = ''
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    runs.push({ node: t, start: text.length })
    text += t.data
  }
  return { text, runs }
}

function locate(runs: TextRun[], offset: number): { node: Text; offset: number } {
  // 二分探索で offset を含むテキストノードを探す
  let lo = 0
  let hi = runs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (runs[mid].start <= offset) lo = mid
    else hi = mid - 1
  }
  const run = runs[lo]
  return { node: run.node, offset: Math.min(offset - run.start, run.node.data.length) }
}

export function findRanges(root: HTMLElement, queries: string[], opts: { caseSensitive?: boolean; limit?: number } = {}): Range[] {
  const needles = queries.map((q) => q.trim()).filter((q) => q.length > 0)
  if (needles.length === 0) return []
  const { text, runs } = collectText(root)
  if (runs.length === 0) return []
  const hay = opts.caseSensitive ? text : text.toLowerCase()
  const limit = opts.limit ?? 5000
  const ranges: Range[] = []
  for (const q of needles) {
    const needle = opts.caseSensitive ? q : q.toLowerCase()
    let idx = 0
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      const s = locate(runs, idx)
      const e = locate(runs, idx + needle.length)
      const r = document.createRange()
      r.setStart(s.node, s.offset)
      r.setEnd(e.node, e.offset)
      ranges.push(r)
      idx += needle.length
      if (ranges.length >= limit) return ranges
    }
  }
  ranges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b))
  return ranges
}

export function setHighlight(name: string, ranges: Range[]): void {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!registry || !HighlightCtor) return
  if (ranges.length === 0) registry.delete(name)
  else registry.set(name, new HighlightCtor(...ranges))
}
