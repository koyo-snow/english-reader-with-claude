// 仕様書「ファイル内検索」「ハイライト」：DOM を書き換えずに一致箇所の範囲を求める
import { beforeEach, describe, expect, it } from 'vitest'
import { findRanges } from '../../../src/renderer/src/textRanges'

let root: HTMLElement

function mount(html: string, wrapperClass = ''): HTMLElement {
  document.body.innerHTML = `<div class="${wrapperClass}"><div id="root">${html}</div></div>`
  root = document.getElementById('root') as HTMLElement
  return root
}
const texts = (ranges: Range[]) => ranges.map((r) => r.toString())

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('一致箇所の検索', () => {
  it('READ-30 一致箇所をすべて、文書の先頭から順に返す', () => {
    mount('<p>The loop runs. Another loop waits.</p><p>Final loop.</p>')
    const ranges = findRanges(root, ['loop'])
    expect(texts(ranges)).toEqual(['loop', 'loop', 'loop'])
    expect(ranges[0].startContainer.parentElement?.tagName).toBe('P')
    expect(ranges[0].startOffset).toBe(4)
    expect(ranges[2].startContainer.textContent).toBe('Final loop.')
  })

  it('READ-31 大文字小文字を区別しない', () => {
    mount('<p>Event loop, EVENT LOOP, event Loop</p>')
    expect(texts(findRanges(root, ['event loop']))).toEqual(['Event loop', 'EVENT LOOP', 'event Loop'])
  })

  it('READ-32 強調やリンクなどの要素をまたぐ語句も見つける', () => {
    mount('<p>The <strong>event</strong> <em>lo</em>op is <a href="#">simple</a>.</p>')
    const ranges = findRanges(root, ['event loop is simple'])
    expect(texts(ranges)).toEqual(['event loop is simple'])
  })

  it('READ-33 検索しても DOM は書き換えない', () => {
    mount('<p>The <strong>event</strong> loop.</p>')
    const before = root.innerHTML
    findRanges(root, ['event', 'loop'])
    expect(root.innerHTML).toBe(before)
  })

  it('READ-34 空の検索語・一致なしでは何も返さない', () => {
    mount('<p>Some text.</p>')
    expect(findRanges(root, [])).toEqual([])
    expect(findRanges(root, ['', '   '])).toEqual([])
    expect(findRanges(root, ['zebra'])).toEqual([])
  })

  it('READ-35 複数の語句（複数のハイライト）をまとめて探せる', () => {
    mount('<p>alpha beta gamma alpha</p>')
    expect(texts(findRanges(root, ['gamma', 'alpha']))).toEqual(['alpha', 'gamma', 'alpha'])
  })

  it('READ-36 非表示にしたタイムスタンプは検索の対象にしない', () => {
    const html = '<p class="ts-only"><a class="ts">00:12:34</a></p><p><a class="ts">00:12:40</a> at 12 o\'clock</p>'
    mount(html)
    expect(texts(findRanges(root, ['12']))).toEqual(['12', '12', '12'])
    mount(html, 'ts-hidden')
    expect(texts(findRanges(root, ['12']))).toEqual(['12'])
  })

  it('READ-37 件数の上限を超えたら打ち切る（大きなファイルで固まらないため）', () => {
    mount(`<p>${'a '.repeat(500)}</p>`)
    expect(findRanges(root, ['a'], { limit: 50 })).toHaveLength(50)
    expect(findRanges(root, ['a'])).toHaveLength(500)
  })
})
