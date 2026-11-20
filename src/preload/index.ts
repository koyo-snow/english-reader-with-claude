import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppState,
  ClaudeEvent,
  ClaudeInfo,
  ClaudeRunRequest,
  FileContent,
  MenuCommand,
  SaveOutputRequest,
  Settings,
  SpeechState,
  TreeNode,
  VaultChange
} from '@shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (next: Settings): Promise<Settings> => ipcRenderer.invoke('settings:set', next),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseFolder'),
    chooseFile: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseFile')
  },
  state: {
    get: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
    patch: (patch: Partial<AppState>): Promise<AppState> => ipcRenderer.invoke('state:patch', patch)
  },
  vault: {
    tree: (): Promise<TreeNode[]> => ipcRenderer.invoke('vault:tree'),
    exists: (): Promise<boolean> => ipcRenderer.invoke('vault:exists'),
    read: (rel: string): Promise<FileContent> => ipcRenderer.invoke('vault:read', rel),
    saveOutput: (req: SaveOutputRequest): Promise<string> => ipcRenderer.invoke('vault:saveOutput', req),
    onTree: (cb: (tree: TreeNode[]) => void) => on<TreeNode[]>('vault:tree', cb),
    onChange: (cb: (change: VaultChange) => void) => on<VaultChange>('vault:change', cb)
  },
  claude: {
    run: (req: ClaudeRunRequest): Promise<void> => ipcRenderer.invoke('claude:run', req),
    stop: (): Promise<void> => ipcRenderer.invoke('claude:stop'),
    info: (): Promise<ClaudeInfo> => ipcRenderer.invoke('claude:info'),
    onEvent: (cb: (ev: ClaudeEvent) => void) => on<ClaudeEvent>('claude:event', cb)
  },
  speech: {
    speak: (text: string): Promise<void> => ipcRenderer.invoke('speech:speak', text),
    stop: (): Promise<void> => ipcRenderer.invoke('speech:stop'),
    onState: (cb: (state: SpeechState) => void) => on<SpeechState>('speech:state', cb)
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  },
  menu: {
    onCommand: (cb: (cmd: MenuCommand) => void) => on<MenuCommand>('menu:command', cb)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
