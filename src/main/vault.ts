// Vault のツリー走査、ファイル読み取り、監視、AI 出力の保存。
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { watch, type FSWatcher } from 'chokidar'
import type { FileContent, SaveOutputRequest, TreeNode, VaultChange } from '@shared/types'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function isHidden(name: string): boolean {
  return name.startsWith('.')
}

/** フォルダと .md ファイルだけのツリー。.md を含まないフォルダは省く。 */
export function scanTree(vaultPath: string): TreeNode[] {
  if (!vaultPath || !fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) return []
  const walk = (dir: string, rel: string): TreeNode[] => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const folders: TreeNode[] = []
    const files: TreeNode[] = []
    for (const e of entries) {
      if (isHidden(e.name)) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        const children = walk(path.join(dir, e.name), childRel)
        if (children.length > 0) folders.push({ name: e.name, path: childRel, kind: 'folder', children })
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        files.push({ name: e.name, path: childRel, kind: 'file' })
      }
    }
    folders.sort((a, b) => collator.compare(a.name, b.name))
    files.sort((a, b) => collator.compare(a.name, b.name))
    return [...folders, ...files]
  }
  return walk(vaultPath, '')
}

/** Vault 配下に収まる絶対パスに解決する。外を指していれば例外。 */
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  const normRoot = path.resolve(root)
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`Vault の外のパスは扱えません: ${rel}`)
  }
  return abs
}

export function readVaultFile(vaultPath: string, rel: string): FileContent {
  const abs = resolveInside(vaultPath, rel)
  const raw = fs.readFileSync(abs, 'utf8')
  const stat = fs.statSync(abs)
  let body = raw
  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = matter(raw)
    body = parsed.content
    frontmatter = parsed.data ?? {}
  } catch {
    // frontmatter が壊れていても本文は表示する
  }
  return {
    path: rel,
    name: path.basename(rel),
    body,
    frontmatter,
    charCount: body.length,
    mtimeMs: stat.mtimeMs
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function yamlString(s: string): string {
  return JSON.stringify(s)
}

/** AI 出力を保存先フォルダに新規ファイルとして書く。既存ファイルは上書きしない。 */
export function saveOutput(vaultPath: string, folder: string, req: SaveOutputRequest): string {
  if (!vaultPath) throw new Error('Vault が設定されていません')
  const dirAbs = resolveInside(vaultPath, folder || 'AI Notes')
  fs.mkdirSync(dirAbs, { recursive: true })
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const base = path.basename(req.sourcePath, path.extname(req.sourcePath)) || 'untitled'
  let name = `${base}_AI_${stamp}.md`
  let abs = path.join(dirAbs, name)
  let i = 2
  while (fs.existsSync(abs)) {
    name = `${base}_AI_${stamp}-${i}.md`
    abs = path.join(dirAbs, name)
    i++
  }
  // 書き込み先が保存先フォルダ内であることを再確認
  resolveInside(dirAbs, name)
  const fm = [
    '---',
    `source: ${yamlString(req.sourcePath)}`,
    `prompt: ${yamlString(req.promptName)}`,
    `date: ${yamlString(now.toISOString())}`,
    '---',
    ''
  ].join('\n')
  fs.writeFileSync(abs, fm + req.markdown.trimEnd() + '\n', { flag: 'wx' })
  return path.relative(vaultPath, abs)
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private onChange: (change: VaultChange) => void,
    private onTreeDirty: () => void
  ) {}

  async start(vaultPath: string): Promise<void> {
    await this.stop()
    if (!vaultPath || !fs.existsSync(vaultPath)) return
    this.watcher = watch(vaultPath, {
      ignoreInitial: true,
      ignored: (p: string, stats?: fs.Stats) => {
        const rel = path.relative(vaultPath, p)
        if (rel.split(path.sep).some((seg) => isHidden(seg))) return true
        if (stats?.isFile() && !p.toLowerCase().endsWith('.md')) return true
        return false
      },
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })
    const handler = (event: VaultChange['event']) => (p: string) => {
      const rel = path.relative(vaultPath, p).split(path.sep).join('/')
      this.onChange({ event, path: rel })
      if (event !== 'change') this.markDirty()
    }
    this.watcher
      .on('add', handler('add'))
      .on('change', handler('change'))
      .on('unlink', handler('unlink'))
      .on('addDir', handler('addDir'))
      .on('unlinkDir', handler('unlinkDir'))
      .on('error', (err) => console.error('[watch]', err))
  }

  private markDirty(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onTreeDirty()
    }, 300)
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
