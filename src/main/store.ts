// settings.json / state.json の読み書き。破損時は退避して既定値で起動する。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROMPTS, DEFAULT_SETTINGS, DEFAULT_STATE, clampSpeechRate, type AppState, type Settings } from '@shared/types'

function userDataFile(name: string): string {
  return path.join(app.getPath('userData'), name)
}

function readJson<T>(file: string, fallback: T, migrate: (raw: unknown) => T): T {
  if (!fs.existsSync(file)) return fallback
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return migrate(raw)
  } catch (err) {
    const broken = file.replace(/\.json$/, '.broken.json')
    try {
      fs.copyFileSync(file, broken)
    } catch {
      /* ignore */
    }
    console.error(`[store] ${path.basename(file)} の読み込みに失敗したため ${path.basename(broken)} に退避しました`, err)
    return fallback
  }
}

function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 既定値に対して深いマージを行い、欠けた項目を補う。 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(patch) || !isObj(base)) return (patch === undefined ? base : (patch as T))
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as Record<string, unknown>)[k]
    out[k] = isObj(b) && isObj(v) ? deepMerge(b, v) : v
  }
  return out as T
}

function migrateSettings(raw: unknown): Settings {
  if (!isObj(raw)) return structuredClone(DEFAULT_SETTINGS)
  const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), raw)
  if (!Array.isArray(merged.prompts) || merged.prompts.length === 0) {
    merged.prompts = structuredClone(DEFAULT_PROMPTS)
  }
  merged.prompts = merged.prompts
    .filter((p) => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({
      id: p.id,
      name: p.name,
      body: typeof p.body === 'string' ? p.body : '',
      defaultInput: ['selection', 'paragraph', 'wholeFile'].includes(p.defaultInput as string)
        ? p.defaultInput
        : 'selection',
      model: ['sonnet', 'opus', 'haiku'].includes(p.model as string) ? p.model : null,
      showInContextMenu: p.showInContextMenu !== false
    }))
  merged.speech = { rate: clampSpeechRate(merged.speech?.rate) }
  merged.version = 1
  return merged
}

function migrateState(raw: unknown): AppState {
  if (!isObj(raw)) return structuredClone(DEFAULT_STATE)
  const merged = deepMerge(structuredClone(DEFAULT_STATE), raw)
  if (!Array.isArray(merged.treeOpen)) merged.treeOpen = []
  if (!isObj(merged.scroll)) merged.scroll = {}
  if (!isObj(merged.highlights)) merged.highlights = {}
  merged.version = 1
  return merged
}

class JsonStore<T> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  constructor(
    private file: string,
    fallback: T,
    migrate: (raw: unknown) => T,
    private delayMs: number
  ) {
    this.data = readJson(file, fallback, migrate)
  }
  get(): T {
    return this.data
  }
  set(next: T): void {
    this.data = next
    this.scheduleWrite()
  }
  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      writeJsonAtomic(this.file, this.data)
    } catch (err) {
      console.error('[store] 書き込みに失敗', this.file, err)
    }
  }
}

export let settingsStore: JsonStore<Settings>
export let stateStore: JsonStore<AppState>

export function initStores(): void {
  settingsStore = new JsonStore(userDataFile('settings.json'), structuredClone(DEFAULT_SETTINGS), migrateSettings, 150)
  stateStore = new JsonStore(userDataFile('state.json'), structuredClone(DEFAULT_STATE), migrateState, 500)
}

export function flushStores(): void {
  settingsStore?.flush()
  stateStore?.flush()
}
