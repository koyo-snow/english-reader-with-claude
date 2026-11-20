// 仕様書「左ドロワー：ファイルツリー」「出力を保存」「セキュリティ（読み取り・書き込みの範囲）」
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultWatcher, readVaultFile, resolveInside, saveOutput, scanTree } from '../../../src/main/vault'
import type { TreeNode, VaultChange } from '@shared/types'

let root: string
let vault: string

function write(rel: string, content = '# note\n'): void {
  const abs = path.join(vault, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** ツリーを「パス」の並びに平たくする（フォルダは末尾に / を付ける）。 */
function flatten(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === 'folder' ? [`${n.path}/`, ...flatten(n.children ?? [])] : [n.path]))
}

/** Vault 配下の全ファイル（相対パス → 内容）。 */
function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) Object.assign(out, snapshot(abs, base))
    else out[path.relative(base, abs)] = fs.readFileSync(abs, 'utf8')
  }
  return out
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'er-vault-')))
  vault = path.join(root, 'vault')
  fs.mkdirSync(vault)
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('ファイルツリーの走査', () => {
  it('TREE-01 フォルダと .md ファイルだけを表示対象にする', () => {
    write('note.md')
    write('image.png', 'x')
    write('data.json', '{}')
    write('memo.txt', 'x')
    write('docs/guide.md')
    write('docs/guide.pdf', 'x')
    expect(flatten(scanTree(vault))).toEqual(['docs/', 'docs/guide.md', 'note.md'])
  })

  it('TREE-02 「.」で始まるフォルダ・ファイル（.obsidian、.trash など）は除外する', () => {
    write('.obsidian/app.json', '{}')
    write('.obsidian/plugins/readme.md')
    write('.trash/deleted.md')
    write('.hidden.md')
    write('docs/.draft.md')
    write('docs/visible.md')
    expect(flatten(scanTree(vault))).toEqual(['docs/', 'docs/visible.md'])
  })

  it('TREE-03 .md を 1 つも含まないフォルダは表示しない（入れ子・隠しファイルだけの場合も）', () => {
    write('empty/notes.txt', 'x')
    fs.mkdirSync(path.join(vault, 'really-empty'))
    write('nested/deep/only.txt', 'x')
    write('hidden-only/.secret.md')
    write('has/deep/note.md')
    expect(flatten(scanTree(vault))).toEqual(['has/', 'has/deep/', 'has/deep/note.md'])
  })

  it('TREE-04 フォルダが先、次にファイル。それぞれ名前の昇順（大文字小文字を区別しない、数字は自然順）', () => {
    write('zeta.md')
    write('Alpha.md')
    write('beta.md')
    write('Chapter 10.md')
    write('Chapter 2.md')
    write('Chapter 1.md')
    write('videos/a.md')
    write('Books/a.md')
    write('archive/a.md')
    const top = scanTree(vault)
    expect(top.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'folder:archive',
      'folder:Books',
      'folder:videos',
      'file:Alpha.md',
      'file:beta.md',
      'file:Chapter 1.md',
      'file:Chapter 2.md',
      'file:Chapter 10.md',
      'file:zeta.md'
    ])
  })

  it('TREE-05 path は Vault からの相対パス（/ 区切り）', () => {
    write('a/b/c.md')
    const [a] = scanTree(vault)
    expect(a).toMatchObject({ name: 'a', path: 'a', kind: 'folder' })
    expect(a.children?.[0]).toMatchObject({ name: 'b', path: 'a/b', kind: 'folder' })
    expect(a.children?.[0].children?.[0]).toEqual({ name: 'c.md', path: 'a/b/c.md', kind: 'file' })
  })

  it('TREE-06 Vault パスが未設定・存在しない・フォルダでない場合は空のツリー', () => {
    write('note.md')
    expect(scanTree('')).toEqual([])
    expect(scanTree(path.join(root, 'no-such-vault'))).toEqual([])
    expect(scanTree(path.join(vault, 'note.md'))).toEqual([])
  })
})

describe('ファイルの読み取り', () => {
  it('MD-20 frontmatter は本文から除き、ファイル情報として返す', () => {
    write('videos/Talk.md', '---\ntitle: Event Loop\nurl: https://www.youtube.com/watch?v=abc\n---\n# Talk\n\nHello.\n')
    const f = readVaultFile(vault, 'videos/Talk.md')
    expect(f.path).toBe('videos/Talk.md')
    expect(f.name).toBe('Talk.md')
    expect(f.body).toBe('# Talk\n\nHello.\n')
    expect(f.body).not.toContain('title:')
    expect(f.frontmatter).toEqual({ title: 'Event Loop', url: 'https://www.youtube.com/watch?v=abc' })
  })

  it('MD-21 frontmatter がないファイルは全文が本文になる', () => {
    write('plain.md', '# Plain\n\ntext\n')
    const f = readVaultFile(vault, 'plain.md')
    expect(f.body).toBe('# Plain\n\ntext\n')
    expect(f.frontmatter).toEqual({})
  })

  it('MD-22 frontmatter が壊れていても本文は読める', () => {
    write('broken.md', '---\ntitle: [unclosed\n  bad: : :\n---\nBody text\n')
    const f = readVaultFile(vault, 'broken.md')
    expect(f.body).toContain('Body text')
  })

  it('IN-20 文字数は frontmatter を除いた本文の文字数（空白・改行を含む）', () => {
    write('count.md', '---\ntitle: x\n---\na b\n\nc\n')
    const f = readVaultFile(vault, 'count.md')
    expect(f.body).toBe('a b\n\nc\n')
    expect(f.charCount).toBe(7)
  })

  it('SEC-10 Vault の外のファイルは読めない', () => {
    fs.writeFileSync(path.join(root, 'secret.md'), 'secret')
    fs.mkdirSync(path.join(root, 'vault-evil'))
    fs.writeFileSync(path.join(root, 'vault-evil', 'x.md'), 'evil')
    expect(() => readVaultFile(vault, '../secret.md')).toThrow(/Vault の外/)
    expect(() => readVaultFile(vault, path.join(root, 'secret.md'))).toThrow(/Vault の外/)
    expect(() => readVaultFile(vault, 'docs/../../secret.md')).toThrow(/Vault の外/)
    // 名前が Vault と同じ文字列で始まる隣のフォルダも外として扱う
    expect(() => readVaultFile(vault, '../vault-evil/x.md')).toThrow(/Vault の外/)
  })

  it('SEC-11 Vault の中に解決されるパスは許可する', () => {
    write('docs/a.md', 'A')
    expect(resolveInside(vault, 'docs/a.md')).toBe(path.join(vault, 'docs', 'a.md'))
    expect(resolveInside(vault, 'docs/../docs/a.md')).toBe(path.join(vault, 'docs', 'a.md'))
    expect(readVaultFile(vault, 'docs/../docs/a.md').body).toBe('A')
  })
})

describe('出力を保存', () => {
  const req = { sourcePath: 'videos/Talk.md', promptName: '自然な日本語に訳す', markdown: '## 回答\n\n訳文です。\n\n' }

  beforeEach(() => {
    // 2026-10-07 09:05（ローカル時刻）
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 9, 5, 30))
    write('videos/Talk.md', '# Talk\n')
  })

  it('OUT-20 既定の保存先 AI Notes/ に {元ファイル名}_AI_{YYYYMMDD-HHmm}.md を新規作成する', () => {
    const rel = saveOutput(vault, 'AI Notes', req)
    expect(rel).toBe(path.join('AI Notes', 'Talk_AI_20261007-0905.md'))
    expect(fs.existsSync(path.join(vault, 'AI Notes', 'Talk_AI_20261007-0905.md'))).toBe(true)
  })

  it('OUT-21 保存先が空なら AI Notes/ を使う', () => {
    expect(saveOutput(vault, '', req)).toBe(path.join('AI Notes', 'Talk_AI_20261007-0905.md'))
  })

  it('OUT-22 設定した保存先フォルダ（入れ子も可）に保存し、なければ作る', () => {
    const rel = saveOutput(vault, 'Notes/AI', req)
    expect(rel).toBe(path.join('Notes', 'AI', 'Talk_AI_20261007-0905.md'))
    expect(fs.statSync(path.join(vault, 'Notes', 'AI')).isDirectory()).toBe(true)
  })

  it('OUT-23 先頭に元ファイルへのパス・プロンプト名・日時を frontmatter として記録する', () => {
    const rel = saveOutput(vault, 'AI Notes', req)
    const raw = fs.readFileSync(path.join(vault, rel), 'utf8')
    expect(raw.startsWith('---\n')).toBe(true)
    const parsed = matter(raw)
    expect(parsed.data.source).toBe('videos/Talk.md')
    expect(parsed.data.prompt).toBe('自然な日本語に訳す')
    expect(new Date(parsed.data.date as string).getTime()).toBe(new Date(2026, 9, 7, 9, 5, 30).getTime())
    expect(parsed.content.trim()).toBe('## 回答\n\n訳文です。')
  })

  it('OUT-24 プロンプト名やパスに記号が含まれても frontmatter が壊れない', () => {
    const tricky = { sourcePath: 'docs/a: "b" #c.md', promptName: ' 訳: "直訳" と\n意訳 # --- ', markdown: 'ok' }
    write(tricky.sourcePath)
    const rel = saveOutput(vault, 'AI Notes', tricky)
    const parsed = matter(fs.readFileSync(path.join(vault, rel), 'utf8'))
    expect(parsed.data.source).toBe(tricky.sourcePath)
    expect(parsed.data.prompt).toBe(tricky.promptName)
    expect(parsed.content.trim()).toBe('ok')
  })

  it('OUT-25 既存ファイルを上書きしない（同じ分に保存しても別ファイルになる）', () => {
    const first = saveOutput(vault, 'AI Notes', { ...req, markdown: 'first' })
    const second = saveOutput(vault, 'AI Notes', { ...req, markdown: 'second' })
    const third = saveOutput(vault, 'AI Notes', { ...req, markdown: 'third' })
    expect(new Set([first, second, third]).size).toBe(3)
    expect(fs.readFileSync(path.join(vault, first), 'utf8')).toContain('first')
    expect(fs.readFileSync(path.join(vault, second), 'utf8')).toContain('second')
    expect(fs.readFileSync(path.join(vault, third), 'utf8')).toContain('third')
    for (const rel of [first, second, third]) expect(path.basename(rel)).toMatch(/^Talk_AI_20261007-0905(-\d+)?\.md$/)
  })

  it('OUT-26 元ファイルには追記せず、保存先フォルダ以外には何も書かない', () => {
    write('other/untouched.md', 'keep')
    const before = snapshot(vault)
    const rel = saveOutput(vault, 'AI Notes', req)
    const after = snapshot(vault)
    expect(Object.keys(after).filter((k) => !(k in before))).toEqual([rel])
    for (const [k, v] of Object.entries(before)) expect(after[k], k).toBe(v)
  })

  it('SEC-12 保存先フォルダが Vault の外を指していれば書き込まない', () => {
    const before = snapshot(root)
    expect(() => saveOutput(vault, '../outside', req)).toThrow(/Vault の外/)
    expect(() => saveOutput(vault, path.join(root, 'abs-outside'), req)).toThrow(/Vault の外/)
    expect(snapshot(root)).toEqual(before)
    expect(fs.existsSync(path.join(root, 'outside'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'abs-outside'))).toBe(false)
  })

  it('SEC-13 元ファイルのパスに .. が含まれても保存先フォルダの外には書かない', () => {
    const rel = saveOutput(vault, 'AI Notes', { ...req, sourcePath: '../../etc/passwd.md' })
    expect(path.dirname(rel)).toBe('AI Notes')
    expect(path.basename(rel)).toBe('passwd_AI_20261007-0905.md')
  })

  it('OUT-27 Vault が未設定なら保存できない', () => {
    expect(() => saveOutput('', 'AI Notes', req)).toThrow(/Vault が設定されていません/)
  })
})

describe('ファイル監視', () => {
  let watcher: VaultWatcher
  let changes: VaultChange[]
  let dirty: number

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const has = (event: VaultChange['event'], p: string) => changes.some((c) => c.event === event && c.path === p)

  beforeEach(async () => {
    write('existing.md', 'old')
    write('docs/guide.md', 'guide')
    changes = []
    dirty = 0
    watcher = new VaultWatcher(
      (c) => changes.push(c),
      () => dirty++
    )
    await watcher.start(vault)
    await sleep(500) // 初回スキャンの完了を待つ
  })

  afterEach(async () => {
    await watcher.stop()
  })

  it('TREE-20 .md の追加を通知し、ツリーの再読み込みを要求する', async () => {
    write('docs/new.md', 'new')
    await vi.waitFor(() => expect(has('add', 'docs/new.md')).toBe(true), { timeout: 5000 })
    await vi.waitFor(() => expect(dirty).toBeGreaterThan(0), { timeout: 5000 })
  })

  it('TREE-21 .md の削除を通知し、ツリーの再読み込みを要求する', async () => {
    fs.rmSync(path.join(vault, 'existing.md'))
    await vi.waitFor(() => expect(has('unlink', 'existing.md')).toBe(true), { timeout: 5000 })
    await vi.waitFor(() => expect(dirty).toBeGreaterThan(0), { timeout: 5000 })
  })

  it('TREE-22 名前変更は削除と追加として通知する', async () => {
    fs.renameSync(path.join(vault, 'existing.md'), path.join(vault, 'renamed.md'))
    await vi.waitFor(
      () => {
        expect(has('unlink', 'existing.md')).toBe(true)
        expect(has('add', 'renamed.md')).toBe(true)
      },
      { timeout: 5000 }
    )
    await vi.waitFor(() => expect(dirty).toBeGreaterThan(0), { timeout: 5000 })
  })

  it('TREE-23 内容の変更を通知する（表示中ファイルの再読み込み用）', async () => {
    fs.writeFileSync(path.join(vault, 'existing.md'), 'updated by obsidian')
    await vi.waitFor(() => expect(has('change', 'existing.md')).toBe(true), { timeout: 5000 })
  })

  it('TREE-24 隠しフォルダ内と .md 以外のファイルの変更は通知しない', async () => {
    write('.obsidian/workspace.json', '{}')
    write('.trash/gone.md', 'x')
    write('image.png', 'x')
    write('marker.md', 'marker') // これが届くまで待てば、前の 3 つは無視されたと言える
    await vi.waitFor(() => expect(has('add', 'marker.md')).toBe(true), { timeout: 5000 })
    const paths = changes.map((c) => c.path)
    expect(paths.some((p) => p.startsWith('.obsidian') || p.startsWith('.trash'))).toBe(false)
    expect(paths).not.toContain('image.png')
  })

  it('TREE-25 停止後は通知しない', async () => {
    await watcher.stop()
    const dirtyAtStop = dirty
    write('after-stop.md', 'x')
    await sleep(800)
    expect(changes.some((c) => c.path === 'after-stop.md')).toBe(false)
    expect(dirty).toBe(dirtyAtStop)
  })
})
