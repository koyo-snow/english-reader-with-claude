// 型定義と既定値。メイン・プリロード・レンダラーで共有する。

export type InputUnit = 'selection' | 'paragraph' | 'wholeFile'
export type Theme = 'system' | 'light' | 'dark'
export type ModelName = 'sonnet' | 'opus' | 'haiku'

export interface PromptDef {
  id: string
  name: string
  body: string
  defaultInput: InputUnit
  model: ModelName | null
  showInContextMenu: boolean
}

export interface DrawerLayout {
  open: boolean
  width?: number
  height?: number
}

export interface Settings {
  version: 1
  vaultPath: string
  theme: Theme
  reader: {
    fontFamily: string
    codeFontFamily: string
    fontSize: number
    lineHeight: number
    maxLineWidthCh: number
    showTimestamps: boolean
    videoUrlKeys: string[]
  }
  ai: {
    claudePath: string
    defaultModel: ModelName
    wholeFileCharLimit: number
    responseLanguage: 'ja' | 'en'
    systemPrompt: string
  }
  save: {
    folder: string
    scope: 'conversation' | 'latest'
  }
  speech: {
    rate: number // 読み上げ速度の倍率。SPEECH_RATE.min〜max
  }
  prompts: PromptDef[]
  layout: {
    left: { open: boolean; width: number }
    right: { open: boolean; width: number }
    bottom: { open: boolean; height: number }
  }
}

export interface AppState {
  version: 1
  scroll: Record<string, number>
  highlights: Record<string, string[]>
  treeOpen: string[]
  lastFile: string | null
  window: { x: number; y: number; width: number; height: number } | null
}

export interface TreeNode {
  name: string
  path: string // Vault からの相対パス
  kind: 'folder' | 'file'
  children?: TreeNode[]
}

export interface FileContent {
  path: string
  name: string
  body: string // frontmatter を除いた本文
  frontmatter: Record<string, unknown>
  charCount: number
  mtimeMs: number
}

export interface ClaudeRunRequest {
  runId: string
  prompt: string // 送信する全文（プロンプト本文 + 区切り + 入力）
  model: ModelName
  resumeSessionId?: string
}

export type ClaudeEvent =
  | { runId: string; type: 'session'; sessionId: string }
  | { runId: string; type: 'delta'; text: string }
  | { runId: string; type: 'done'; sessionId: string; costUsd: number }
  | { runId: string; type: 'error'; kind: ClaudeErrorKind; message: string }

export type ClaudeErrorKind =
  | 'cli-not-found'
  | 'not-logged-in'
  | 'usage-limit'
  | 'timeout'
  | 'aborted'
  | 'unknown'

export interface ClaudeInfo {
  configuredPath: string
  resolvedPath: string | null
  source: 'settings' | 'detected' | 'bundled'
}

export interface SpeechState {
  speaking: boolean
  error?: string
}

export interface SaveOutputRequest {
  sourcePath: string
  promptName: string
  markdown: string
}

export type VaultChange = { event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }

export type MenuCommand =
  | 'toggle-left'
  | 'toggle-right'
  | 'toggle-bottom'
  | 'find'
  | 'settings'
  | 'run'
  | 'open-vault'

export const DEFAULT_SYSTEM_PROMPT =
  'あなたは英語の技術文書の読解を助けるアシスタントです。日本語で回答してください。'

export const DEFAULT_PROMPTS: PromptDef[] = [
  {
    id: 'translate-natural',
    name: '自然な日本語に訳す',
    body: '次の英文を自然な日本語に訳してください。技術用語は原語を括弧で残してください。訳文以外の前置きは不要です。',
    defaultInput: 'paragraph',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'literal-and-free',
    name: '直訳と意訳',
    body: '次の英文について、まず直訳、次に自然な意訳を示してください。最後に、構文のポイント（主語・動詞の対応、修飾関係など）を2〜3行で短く添えてください。',
    defaultInput: 'selection',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'word-meaning',
    name: '単語・イディオムの意味',
    body: '次の語句（または文中の重要な語句）について、この文脈での意味、品詞、発音記号、類義語、そして短い例文を1つ示してください。文が渡された場合は、難しい語句を2〜5個選んで同じ形式で説明してください。',
    defaultInput: 'selection',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'grammar',
    name: '文法・構文の解説',
    body: '次の英文の構造を解説してください。主節と従属節、修飾関係、省略されている語、分詞構文や関係詞などのポイントを分解して説明し、最後に全体の訳を添えてください。',
    defaultInput: 'selection',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'tech-term',
    name: '技術用語・概念の解説',
    body: '次のテキストに出てくる技術用語・概念を初学者向けに解説してください。定義、なぜ必要なのか、具体例、関連する概念の順に説明してください。',
    defaultInput: 'selection',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'prerequisites',
    name: '前提知識の補足',
    body: '次の箇所を理解するために必要な前提知識を挙げ、それぞれを簡潔に補足説明してください。知っていると理解が深まる周辺知識があれば最後に添えてください。',
    defaultInput: 'paragraph',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'example-code',
    name: '具体例・コードで説明',
    body: '次のテキストで説明されている内容を、短いコード例または具体例を使って説明してください。コードにはコメントを付け、何を示しているのかを簡潔に述べてください。',
    defaultInput: 'paragraph',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'mermaid',
    name: 'Mermaidで図解',
    body: '次のテキストで説明されている処理の流れや概念の関係を、Mermaid図（```mermaid ブロック）で図解し、図の読み方を短く説明してください。',
    defaultInput: 'paragraph',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'clean-subtitles',
    name: '字幕を読みやすく整形',
    body: '次のテキストは動画の自動生成字幕です。誤認識と思われる語を文脈から補正し、言いよどみや繰り返しを取り除き、句読点と大文字を付けて読みやすい英文に整えてください。整形した英文のみを出力してください。',
    defaultInput: 'paragraph',
    model: null,
    showInContextMenu: true
  },
  {
    id: 'summary',
    name: '要点を箇条書き',
    body: '次のテキストの主張と要点を、3〜7個の箇条書きで日本語にまとめてください。',
    defaultInput: 'wholeFile',
    model: null,
    showInContextMenu: false
  },
  {
    id: 'quiz',
    name: '理解度チェック',
    body: '次のテキストの内容理解を確かめる問題を3〜5問作ってください。各問題の後に解答と簡単な解説を付けてください。',
    defaultInput: 'wholeFile',
    model: null,
    showInContextMenu: false
  }
]

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  vaultPath: '',
  theme: 'system',
  reader: {
    fontFamily: 'Inter',
    codeFontFamily: 'JetBrains Mono',
    fontSize: 17,
    lineHeight: 1.7,
    maxLineWidthCh: 72,
    showTimestamps: true,
    videoUrlKeys: ['url', 'source']
  },
  ai: {
    claudePath: '',
    defaultModel: 'sonnet',
    wholeFileCharLimit: 1000,
    responseLanguage: 'ja',
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  },
  save: {
    folder: 'AI Notes',
    scope: 'conversation'
  },
  speech: {
    rate: 1
  },
  prompts: DEFAULT_PROMPTS,
  layout: {
    left: { open: true, width: 260 },
    right: { open: true, width: 320 },
    bottom: { open: false, height: 280 }
  }
}

export const DEFAULT_STATE: AppState = {
  version: 1,
  scroll: {},
  highlights: {},
  treeOpen: [],
  lastFile: null,
  window: null
}

/** 読み上げ速度の範囲。say の -r（語/分）は baseWpm × 倍率で渡す。 */
export const SPEECH_RATE = {
  min: 0.3,
  max: 3,
  step: 0.1,
  baseWpm: 175
}

export function clampSpeechRate(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1
  return Math.min(SPEECH_RATE.max, Math.max(SPEECH_RATE.min, Math.round(n * 100) / 100))
}

export const DRAWER_LIMITS = {
  left: { min: 180, max: 520 },
  right: { min: 240, max: 640 },
  bottom: { min: 140, max: 900 }
}

export const INPUT_UNIT_LABELS: Record<InputUnit, string> = {
  selection: '選択範囲',
  paragraph: '段落',
  wholeFile: 'ファイル全体'
}
