// 左ドロワー：Vault のフォルダと .md ファイルのツリー。
import { useMemo, useState } from 'react'
import type { TreeNode } from '@shared/types'

interface Props {
  tree: TreeNode[]
  vaultOk: boolean
  openFolders: Set<string>
  currentFile: string | null
  onToggleFolder: (path: string) => void
  onOpenFile: (path: string) => void
  onOpenSettings: () => void
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.kind === 'folder') {
      const children = filterTree(n.children ?? [], q)
      if (children.length > 0) out.push({ ...n, children })
    } else if (n.name.toLowerCase().includes(q)) {
      out.push(n)
    }
  }
  return out
}

export function FileTree({ tree, vaultOk, openFolders, currentFile, onToggleFolder, onOpenFile, onOpenSettings }: Props) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const shown = useMemo(() => (q ? filterTree(tree, q) : tree), [tree, q])

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) => {
      const isOpen = q ? true : openFolders.has(n.path)
      if (n.kind === 'folder') {
        return (
          <div key={n.path}>
            <div
              className="tree-row folder"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onToggleFolder(n.path)}
              title={n.path}
            >
              <span className="tree-arrow">{isOpen ? '▾' : '▸'}</span>
              <span className="tree-name">{n.name}</span>
            </div>
            {isOpen && renderNodes(n.children ?? [], depth + 1)}
          </div>
        )
      }
      return (
        <div
          key={n.path}
          className={`tree-row file ${currentFile === n.path ? 'active' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 + 14 }}
          onClick={() => onOpenFile(n.path)}
          title={n.path}
        >
          <span className="tree-name">{n.name.replace(/\.md$/i, '')}</span>
        </div>
      )
    })

  return (
    <div className="file-tree">
      <div className="pane-header">
        <input
          className="tree-filter"
          type="search"
          placeholder="ファイル名で絞り込み"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="tree-body">
        {!vaultOk ? (
          <div className="tree-empty">
            Vault が見つかりません。
            <br />
            <button className="link" onClick={onOpenSettings}>
              設定タブで Vault を指定してください
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="tree-empty">{q ? '一致するファイルがありません' : '.md ファイルがありません'}</div>
        ) : (
          renderNodes(shown, 0)
        )}
      </div>
    </div>
  )
}
