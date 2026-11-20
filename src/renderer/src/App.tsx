import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, ClaudeInfo, FileContent, InputUnit, MenuCommand, PromptDef, Settings, Theme, TreeNode } from '@shared/types'
import { DRAWER_LIMITS } from '@shared/types'
import { Drawer } from './components/Drawer'
import { FileTree } from './components/FileTree'
import { Reader } from './components/Reader'
import { RightDrawer, FREE_PROMPT_ID, unitAvailability } from './components/RightDrawer'
import { BottomDrawer } from './components/BottomDrawer'
import { SettingsTab } from './components/SettingsTab'
import { conversationToMarkdown, newId, type Conversation } from './conversation'
import { ensureHighlighter } from './markdown'

type CenterView = 'reader' | 'settings'

function useDarkMode(theme: Theme): boolean {
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return theme === 'dark' || (theme === 'system' && sysDark)
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [appState, setAppState] = useState<AppState | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [vaultOk, setVaultOk] = useState(false)
  const [file, setFile] = useState<FileContent | null>(null)
  const [fileMissing, setFileMissing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [centerView, setCenterView] = useState<CenterView>('reader')
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selection, setSelection] = useState('')
  const [paragraph, setParagraph] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [unit, setUnit] = useState<InputUnit>('selection')
  const [freeText, setFreeText] = useState('')
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [claudeInfo, setClaudeInfo] = useState<ClaudeInfo | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  const fileRef = useRef<FileContent | null>(null)
  settingsRef.current = settings
  fileRef.current = file

  const dark = useDarkMode(settings?.theme ?? 'system')
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  // ---------- 初期化 ----------
  useEffect(() => {
    void ensureHighlighter()
    void (async () => {
      const [s, st, t, ok, info] = await Promise.all([
        window.api.settings.get(),
        window.api.state.get(),
        window.api.vault.tree(),
        window.api.vault.exists(),
        window.api.claude.info()
      ])
      setSettings(s)
      setAppState(st)
      setTree(t)
      setVaultOk(ok)
      setClaudeInfo(info)
      setShowTimestamps(s.reader.showTimestamps)
      setSelectedPromptId(s.prompts[0]?.id ?? FREE_PROMPT_ID)
      setUnit(s.prompts[0]?.defaultInput ?? 'selection')
      if (st.lastFile && ok) void openFile(st.lastFile, st)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 設定・状態の保存 ----------
  const updateSettings = useCallback((updater: (s: Settings) => Settings) => {
    setSettings((prev) => {
      if (!prev) return prev
      const next = updater(prev)
      void window.api.settings.set(next).then(async () => {
        if (next.vaultPath !== prev.vaultPath) {
          setVaultOk(await window.api.vault.exists())
          setFile(null)
          setFileMissing(false)
        }
        if (next.ai.claudePath !== prev.ai.claudePath) setClaudeInfo(await window.api.claude.info())
      })
      return next
    })
  }, [])

  const patchState = useCallback((patch: Partial<AppState>) => {
    setAppState((prev) => (prev ? { ...prev, ...patch } : prev))
    void window.api.state.patch(patch)
  }, [])

  // ---------- Vault ----------
  const openFile = useCallback(
    async (path: string, st?: AppState) => {
      try {
        const f = await window.api.vault.read(path)
        setFile(f)
        setFileMissing(false)
        setCenterView('reader')
        const s = settingsRef.current
        if (s) setShowTimestamps(s.reader.showTimestamps)
        const base = st ?? appState
        if (base?.lastFile !== path) patchState({ lastFile: path })
      } catch (err) {
        console.error(err)
        setFile(null)
        setFileMissing(true)
      }
    },
    [appState, patchState]
  )

  useEffect(() => {
    const offTree = window.api.vault.onTree((t) => {
      setTree(t)
      void window.api.vault.exists().then(setVaultOk)
    })
    const offChange = window.api.vault.onChange(async (c) => {
      const cur = fileRef.current
      if (!cur || c.path !== cur.path) return
      if (c.event === 'unlink') {
        setFile(null)
        setFileMissing(true)
      } else if (c.event === 'change' || c.event === 'add') {
        try {
          const f = await window.api.vault.read(cur.path)
          setReloadKey((k) => k + 1)
          setFile(f)
        } catch {
          setFile(null)
          setFileMissing(true)
        }
      }
    })
    return () => {
      offTree()
      offChange()
    }
  }, [])

  // ---------- Claude ----------
  const startRun = useCallback(
    (opts: { promptName: string; promptBody: string; model: Settings['ai']['defaultModel']; text: string; sourcePath: string }) => {
      const s = settingsRef.current
      if (!s) return
      const runId = newId()
      const fileName = opts.sourcePath.split('/').pop() ?? opts.sourcePath
      const prompt = `${opts.promptBody.trim()}\n\n---\n\nファイル: ${fileName}\n\n${opts.text}`
      const conv: Conversation = {
        id: newId(),
        sessionId: null,
        promptName: opts.promptName,
        sourcePath: opts.sourcePath,
        model: opts.model,
        messages: [
          { id: newId(), role: 'user', text: `${opts.promptName}\n\n${opts.text}`, status: 'done' },
          { id: newId(), role: 'assistant', text: '', status: 'streaming' }
        ],
        runId,
        costUsd: 0
      }
      void window.api.claude.stop()
      setConversation(conv)
      updateSettings((cur) => (cur.layout.bottom.open ? cur : { ...cur, layout: { ...cur.layout, bottom: { ...cur.layout.bottom, open: true } } }))
      void window.api.claude.run({ runId, prompt, model: opts.model })
    },
    [updateSettings]
  )

  const runPrompt = useCallback(
    (p: PromptDef, _unit: InputUnit, text: string) => {
      const s = settingsRef.current
      const f = fileRef.current
      if (!s || !text) return
      startRun({ promptName: p.name, promptBody: p.body, model: p.model ?? s.ai.defaultModel, text, sourcePath: f?.path ?? '' })
    },
    [startRun]
  )

  const runFromDrawer = useCallback(() => {
    const s = settingsRef.current
    const f = fileRef.current
    if (!s) return
    const avail = unitAvailability(unit, selection, paragraph, f, s.ai.wholeFileCharLimit)
    if (!avail.ok) return
    if (selectedPromptId === FREE_PROMPT_ID) {
      if (!freeText.trim()) return
      startRun({ promptName: '自由入力', promptBody: freeText, model: s.ai.defaultModel, text: avail.text, sourcePath: f?.path ?? '' })
    } else {
      const p = s.prompts.find((x) => x.id === selectedPromptId)
      if (p) runPrompt(p, unit, avail.text)
    }
  }, [unit, selection, paragraph, selectedPromptId, freeText, startRun, runPrompt])

  const followUp = useCallback((text: string) => {
    setConversation((conv) => {
      if (!conv) return conv
      const runId = newId()
      void window.api.claude.run({ runId, prompt: text, model: conv.model as Settings['ai']['defaultModel'], resumeSessionId: conv.sessionId ?? undefined })
      return {
        ...conv,
        runId,
        messages: [...conv.messages, { id: newId(), role: 'user', text, status: 'done' }, { id: newId(), role: 'assistant', text: '', status: 'streaming' }]
      }
    })
  }, [])

  useEffect(() => {
    return window.api.claude.onEvent((ev) => {
      setConversation((conv) => {
        if (!conv || conv.runId !== ev.runId) return conv
        const msgs = [...conv.messages]
        const last = msgs[msgs.length - 1]
        if (!last || last.role !== 'assistant') return conv
        switch (ev.type) {
          case 'session':
            return { ...conv, sessionId: ev.sessionId }
          case 'delta':
            msgs[msgs.length - 1] = { ...last, text: last.text + ev.text }
            return { ...conv, messages: msgs }
          case 'done':
            msgs[msgs.length - 1] = { ...last, status: 'done' }
            return { ...conv, messages: msgs, sessionId: ev.sessionId || conv.sessionId, runId: null, costUsd: ev.costUsd }
          case 'error':
            msgs[msgs.length - 1] = { ...last, status: 'error', error: { kind: ev.kind, message: ev.message } }
            return { ...conv, messages: msgs, runId: null }
        }
      })
    })
  }, [])

  const stopRun = useCallback(() => {
    void window.api.claude.stop()
  }, [])

  // ---------- 読み上げ ----------
  const [speaking, setSpeaking] = useState(false)
  const [speechError, setSpeechError] = useState<string | null>(null)
  useEffect(() => {
    return window.api.speech.onState((st) => {
      setSpeaking(st.speaking)
      setSpeechError(st.error ?? null)
    })
  }, [])

  const speakFromDrawer = useCallback(() => {
    const s = settingsRef.current
    const f = fileRef.current
    if (!s) return
    const avail = unitAvailability(unit, selection, paragraph, f, s.ai.wholeFileCharLimit)
    if (!avail.ok) return
    setSpeechError(null)
    void window.api.speech.speak(avail.text)
  }, [unit, selection, paragraph])

  const stopSpeak = useCallback(() => {
    void window.api.speech.stop()
  }, [])
  // 速度は設定として保存し、メインプロセス側が settings:set を受けて say に反映する
  const setSpeechRate = useCallback(
    (rate: number) => updateSettings((s) => (s.speech.rate === rate ? s : { ...s, speech: { ...s.speech, rate } })),
    [updateSettings]
  )

  const saveConversation = useCallback(async (): Promise<string> => {
    const s = settingsRef.current
    if (!s || !conversation) throw new Error('保存する会話がありません')
    const md = conversationToMarkdown(conversation, s.save.scope)
    if (!md.trim()) throw new Error('保存する回答がありません')
    return window.api.vault.saveOutput({ sourcePath: conversation.sourcePath, promptName: conversation.promptName, markdown: md })
  }, [conversation])

  // ---------- メニューコマンド ----------
  const toggleDrawer = useCallback(
    (side: 'left' | 'right' | 'bottom') => {
      updateSettings((s) => ({ ...s, layout: { ...s.layout, [side]: { ...s.layout[side], open: !s.layout[side].open } } }))
    },
    [updateSettings]
  )

  const runFromDrawerRef = useRef(runFromDrawer)
  runFromDrawerRef.current = runFromDrawer
  useEffect(() => {
    return window.api.menu.onCommand((cmd: MenuCommand) => {
      switch (cmd) {
        case 'toggle-left':
          toggleDrawer('left')
          break
        case 'toggle-right':
          toggleDrawer('right')
          break
        case 'toggle-bottom':
          toggleDrawer('bottom')
          break
        case 'find':
          setCenterView('reader')
          setSearchOpen(true)
          break
        case 'settings':
          setCenterView('settings')
          break
        case 'run':
          if (settingsRef.current && !settingsRef.current.layout.right.open) toggleDrawer('right')
          runFromDrawerRef.current()
          break
        case 'open-vault':
          void window.api.settings.chooseFolder().then((p) => {
            if (p) updateSettings((s) => ({ ...s, vaultPath: p }))
          })
          break
      }
    })
  }, [toggleDrawer, updateSettings])

  // ---------- ツリー・ハイライト ----------
  const openFolders = useMemo(() => new Set(appState?.treeOpen ?? []), [appState?.treeOpen])
  const toggleFolder = useCallback(
    (path: string) => {
      const next = new Set(appState?.treeOpen ?? [])
      if (next.has(path)) next.delete(path)
      else next.add(path)
      patchState({ treeOpen: [...next] })
    },
    [appState?.treeOpen, patchState]
  )

  const highlights = useMemo(() => (file ? (appState?.highlights[file.path] ?? []) : []), [file, appState?.highlights])
  const addHighlight = useCallback(
    (text: string) => {
      const f = fileRef.current
      if (!f || !text.trim()) return
      const cur = appState?.highlights[f.path] ?? []
      if (cur.includes(text)) return
      patchState({ highlights: { ...(appState?.highlights ?? {}), [f.path]: [...cur, text] } })
    },
    [appState?.highlights, patchState]
  )
  const removeHighlight = useCallback(
    (text: string) => {
      const f = fileRef.current
      if (!f) return
      const cur = appState?.highlights[f.path] ?? []
      patchState({ highlights: { ...(appState?.highlights ?? {}), [f.path]: cur.filter((h) => h !== text) } })
    },
    [appState?.highlights, patchState]
  )

  const scrollSaveRef = useRef<Record<string, number>>({})
  const onScroll = useCallback(
    (pos: number) => {
      const f = fileRef.current
      if (!f) return
      scrollSaveRef.current = { ...(appState?.scroll ?? {}), ...scrollSaveRef.current, [f.path]: pos }
      patchState({ scroll: scrollSaveRef.current })
    },
    [appState?.scroll, patchState]
  )

  const onSelectPrompt = useCallback((id: string) => {
    setSelectedPromptId(id)
    const p = settingsRef.current?.prompts.find((x) => x.id === id)
    if (p) setUnit(p.defaultInput)
  }, [])

  if (!settings || !appState) return <div className="loading">読み込み中…</div>

  const running = conversation?.runId !== null && conversation?.runId !== undefined
  const layout = settings.layout

  return (
    <div className="app">
      <div className="app-top">
        <Drawer
          side="left"
          open={layout.left.open}
          size={layout.left.width}
          min={DRAWER_LIMITS.left.min}
          max={DRAWER_LIMITS.left.max}
          onResize={(w) => updateSettings((s) => ({ ...s, layout: { ...s.layout, left: { ...s.layout.left, width: w } } }))}
          onToggle={() => toggleDrawer('left')}
        >
          <FileTree
            tree={tree}
            vaultOk={vaultOk}
            openFolders={openFolders}
            currentFile={file?.path ?? null}
            onToggleFolder={toggleFolder}
            onOpenFile={(p) => void openFile(p)}
            onOpenSettings={() => setCenterView('settings')}
          />
        </Drawer>

        <div className="center">
          <div className={`center-tabs ${layout.left.open ? '' : 'traffic-pad'}`}>
            <button className={`tab ${centerView === 'reader' ? 'active' : ''}`} onClick={() => setCenterView('reader')}>
              {file ? file.name.replace(/\.md$/i, '') : '本文'}
            </button>
            {centerView === 'settings' && (
              <button className="tab active" onClick={() => setCenterView('settings')}>
                設定
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCenterView('reader')
                  }}
                >
                  ✕
                </span>
              </button>
            )}
          </div>
          <div className="center-body">
            {centerView === 'settings' ? (
              <SettingsTab settings={settings} onChange={(next) => updateSettings(() => next)} claudeInfo={claudeInfo} />
            ) : (
              <Reader
                file={file}
                fileMissing={fileMissing}
                reader={settings.reader}
                theme={settings.theme}
                dark={dark}
                showTimestamps={showTimestamps}
                onToggleTimestamps={() => setShowTimestamps((v) => !v)}
                highlights={highlights}
                onAddHighlight={addHighlight}
                onRemoveHighlight={removeHighlight}
                prompts={settings.prompts}
                onRunPrompt={runPrompt}
                onSelectionChange={setSelection}
                onParagraphChange={setParagraph}
                searchOpen={searchOpen}
                onCloseSearch={() => setSearchOpen(false)}
                initialScroll={file ? (appState.scroll[file.path] ?? 0) : 0}
                onScroll={onScroll}
                onUpdateReader={(patch) => updateSettings((s) => ({ ...s, reader: { ...s.reader, ...patch } }))}
                onUpdateTheme={(t) => updateSettings((s) => ({ ...s, theme: t }))}
                reloadKey={reloadKey}
              />
            )}
          </div>
        </div>

        <Drawer
          side="right"
          open={layout.right.open}
          size={layout.right.width}
          min={DRAWER_LIMITS.right.min}
          max={DRAWER_LIMITS.right.max}
          onResize={(w) => updateSettings((s) => ({ ...s, layout: { ...s.layout, right: { ...s.layout.right, width: w } } }))}
          onToggle={() => toggleDrawer('right')}
        >
          <RightDrawer
            prompts={settings.prompts}
            selectedPromptId={selectedPromptId}
            onSelectPrompt={onSelectPrompt}
            unit={unit}
            onSelectUnit={setUnit}
            freeText={freeText}
            onFreeTextChange={setFreeText}
            selection={selection}
            paragraph={paragraph}
            file={file}
            charLimit={settings.ai.wholeFileCharLimit}
            running={running}
            onRun={runFromDrawer}
            onStop={stopRun}
            speaking={speaking}
            speechError={speechError}
            onSpeak={speakFromDrawer}
            onStopSpeak={stopSpeak}
            speechRate={settings.speech.rate}
            onSpeechRateChange={setSpeechRate}
          />
        </Drawer>
      </div>

      <Drawer
        side="bottom"
        open={layout.bottom.open}
        size={layout.bottom.height}
        min={DRAWER_LIMITS.bottom.min}
        max={Math.max(DRAWER_LIMITS.bottom.min, window.innerHeight - 220)}
        onResize={(h) => updateSettings((s) => ({ ...s, layout: { ...s.layout, bottom: { ...s.layout.bottom, height: h } } }))}
        onToggle={() => toggleDrawer('bottom')}
      >
        <BottomDrawer
          conversation={conversation}
          dark={dark}
          running={running}
          onFollowUp={followUp}
          onStop={stopRun}
          onSave={saveConversation}
          saveScope={settings.save.scope}
          onOpenSettings={() => setCenterView('settings')}
        />
      </Drawer>
    </div>
  )
}
