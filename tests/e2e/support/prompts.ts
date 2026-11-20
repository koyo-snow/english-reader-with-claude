import type { PromptDef } from '../../../src/shared/types'

/** 並び順・モデル・右クリックメニューの表示有無がそれぞれ違う、テスト用のプロンプト。 */
export const CUSTOM_PROMPTS: PromptDef[] = [
  { id: 'p-whole', name: '全体を要約', body: '次のテキストを要約してください。', defaultInput: 'wholeFile', model: 'haiku', showInContextMenu: false },
  { id: 'p-para', name: '段落を訳す', body: '次の英文を訳してください。', defaultInput: 'paragraph', model: null, showInContextMenu: true },
  { id: 'p-sel', name: '語句を説明', body: '次の語句を説明してください。', defaultInput: 'selection', model: 'opus', showInContextMenu: true }
]

export const CLOSURE_PARAGRAPH = 'A closure is a function that remembers the variables from the place where it was defined.'
export const FOX_PARAGRAPH = 'The quick brown fox jumps over the lazy dog.'
