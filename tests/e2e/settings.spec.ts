// 仕様書「設定タブ」「プロンプト管理」「初期プロンプト」「設定JSON」
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROMPTS, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from '../../src/shared/types'
import { expect, test, type App } from './support/app'
import { CUSTOM_PROMPTS } from './support/prompts'

const promptItems = (app: App) => app.page.locator('.prompt-list .prompt-item')
const promptNames = (app: App) => app.page.locator('.prompt-list .prompt-item-name').allTextContents()
const form = (app: App, label: string) => app.page.locator('.prompt-form .settings-row', { has: app.page.locator('.settings-label', { hasText: label }) })
const listButton = (app: App, name: string) => app.page.locator('.prompt-list-actions').getByRole('button', { name, exact: true })
const savedPrompts = (app: App) => app.settingsOnDisk()?.prompts ?? []

test.describe('設定タブ', () => {
  test('SET-01 Cmd+, で、中央ペインのタブとして開く', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await app.menu('CmdOrCtrl+,')
    const settings = app.page.locator('.settings')
    await expect(settings).toBeVisible()
    // 中央ペインの中に、本文のタブと並んで表示される
    await expect(app.page.locator('.center .settings')).toHaveCount(1)
    await expect(app.page.locator('.center-tabs .tab')).toHaveText(['Short', /設定/])
    await expect(app.left).toHaveClass(/open/)
    await expect(app.right).toHaveClass(/open/)

    await app.page.locator('.center-tabs .tab-close').click()
    await expect(settings).toHaveCount(0)
    await expect(app.body.locator('h1')).toHaveText('Short Note')
  })

  test('SET-02 仕様書の項目がグループごとに並ぶ', async ({ launch }) => {
    const app = await launch()
    const settings = await app.openSettings()
    await expect(settings.locator('h2')).toHaveText(['一般', '本文表示', 'AI', '保存', 'プロンプト'])
    const expected: Record<string, RegExp[]> = {
      一般: [/Vault ?パス/, /テーマ/, /応答言語/],
      本文表示: [/本文フォント/, /コードフォント/, /文字サイズ/, /行間/, /行幅/, /タイムスタンプの初期表示/, /動画 ?URL ?の ?frontmatter ?キー/],
      AI: [/claude ?のパス/, /既定モデル/, /ファイル全体の文字数上限/, /システムプロンプト/],
      保存: [/保存先フォルダ/, /保存範囲/]
    }
    // 各グループの見出しから次の見出しまでにあるラベルを集める
    const groups = await settings.evaluate((root) => {
      const out: Record<string, string[]> = {}
      let current = ''
      for (const el of Array.from(root.children)) {
        if (el.tagName === 'H2') current = el.textContent ?? ''
        else if (el.classList.contains('settings-row')) (out[current] ??= []).push(el.querySelector('.settings-label')?.textContent ?? '')
      }
      return out
    })
    for (const [group, labels] of Object.entries(expected)) {
      for (const re of labels) expect(groups[group].some((l) => re.test(l)), `${group} / ${re}`).toBe(true)
    }
    for (const name of ['追加', '複製', '削除']) await expect(listButton(app, name)).toBeVisible()
    await expect(listButton(app, '初期プロンプトに戻す')).toBeVisible()
  })

  test('SET-03 初期値は仕様書の既定値（文字数上限 1000、保存先 AI Notes など）', async ({ launch }) => {
    const app = await launch()
    await app.openSettings()
    await expect(app.settingRow('ファイル全体の文字数上限').locator('input')).toHaveValue('1000')
    await expect(app.settingRow('保存先フォルダ').locator('input')).toHaveValue('AI Notes')
    await expect(app.settingRow('保存範囲').locator('select')).toHaveValue('conversation')
    await expect(app.settingRow('既定モデル').locator('select')).toHaveValue('sonnet')
    await expect(app.settingRow('応答言語').locator('select')).toHaveValue('ja')
    await expect(app.settingRow('テーマ').locator('select')).toHaveValue('system')
    await expect(app.settingRow('文字サイズ (px)').locator('input')).toHaveValue('17')
    await expect(app.settingRow('システムプロンプト').locator('textarea')).toHaveValue(DEFAULT_SYSTEM_PROMPT)
    await expect(app.settingRow('タイムスタンプの初期表示').locator('input')).toBeChecked()
    await expect(app.settingRow('動画 URL の frontmatter キー').locator('input')).toHaveValue('url, source')
  })

  test('SET-04 変更は保存ボタンなしで即時に反映され、settings.json に自動保存される', async ({ launch }) => {
    const app = await launch()
    await app.openSettings()
    await expect(app.page.locator('.settings').getByRole('button', { name: /^保存$/ })).toHaveCount(0)

    await app.settingRow('応答言語').locator('select').selectOption('en')
    await app.settingRow('既定モデル').locator('select').selectOption('opus')
    await app.settingRow('ファイル全体の文字数上限').locator('input').fill('5000')
    await app.settingRow('システムプロンプト').locator('textarea').fill('You are a careful reading assistant.')
    await app.settingRow('保存先フォルダ').locator('input').fill('Notes/AI')
    await app.settingRow('保存範囲').locator('select').selectOption('latest')
    await app.settingRow('タイムスタンプの初期表示').locator('input').uncheck()
    await app.settingRow('claude のパス').locator('input').fill('/custom/bin/claude')

    await expect
      .poll(() => app.settingsOnDisk())
      .toMatchObject({
        ai: { responseLanguage: 'en', defaultModel: 'opus', wholeFileCharLimit: 5000, systemPrompt: 'You are a careful reading assistant.', claudePath: '/custom/bin/claude' },
        save: { folder: 'Notes/AI', scope: 'latest' },
        reader: { showTimestamps: false }
      })

    // 再起動しても残っている
    await app.restart()
    await app.openSettings()
    await expect(app.settingRow('既定モデル').locator('select')).toHaveValue('opus')
    await expect(app.settingRow('保存先フォルダ').locator('input')).toHaveValue('Notes/AI')
  })

  test('SET-05 claude のパス：指定したパスを使うことを表示し、空欄なら自動検出の結果を表示する', async ({ launch }) => {
    const app = await launch({ settings: { ai: { claudePath: '/custom/bin/claude' } } })
    await app.openSettings()
    const row = app.settingRow('claude のパス')
    await expect(row.locator('.hint')).toContainText('/custom/bin/claude')
    await row.locator('input').fill('')
    await expect(row.locator('.hint')).not.toContainText('/custom/bin/claude')
    await expect(row.locator('.hint')).toHaveText(/自動検出|見つからない/)

    // ファイル選択ダイアログからも指定できる
    await app.setDialogResult('/picked/claude')
    await row.getByRole('button', { name: '選択…' }).click()
    await expect(row.locator('input')).toHaveValue('/picked/claude')
    await expect.poll(() => app.settingsOnDisk()?.ai.claudePath).toBe('/picked/claude')
  })

  test('SET-06 システムプロンプトは既定の文面に戻せる', async ({ launch }) => {
    const app = await launch({ settings: { ai: { systemPrompt: 'custom prompt' } } })
    await app.openSettings()
    const row = app.settingRow('システムプロンプト')
    await expect(row.locator('textarea')).toHaveValue('custom prompt')
    await row.getByRole('button', { name: '既定に戻す' }).click()
    await expect(row.locator('textarea')).toHaveValue(DEFAULT_SYSTEM_PROMPT)
    await expect.poll(() => app.settingsOnDisk()?.ai.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
  })
})

test.describe('プロンプト管理', () => {
  test('PM-20 一覧に、登録済みのプロンプトが保存された順番で並ぶ（初回は初期プロンプト 11 件）', async ({ launch }) => {
    const app = await launch()
    await app.openSettings()
    expect(await promptNames(app)).toEqual(DEFAULT_PROMPTS.map((p) => p.name))
    await expect(promptItems(app)).toHaveCount(11)
  })

  test('PM-21 追加：新しいプロンプトを作り、名前・本文・既定の入力単位・モデル・右クリックメニューへの表示有無を設定できる', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Short.md')
    await app.openSettings()
    await listButton(app, '追加').click()
    await expect(promptItems(app)).toHaveCount(4)
    await expect(promptItems(app).last()).toHaveClass(/active/)

    await form(app, '名前').locator('input').fill('一文で要約')
    await form(app, '本文').locator('textarea').fill('次のテキストを一文で要約してください。')
    await form(app, '既定の入力単位').locator('select').selectOption({ label: 'ファイル全体' })
    await form(app, 'モデル').locator('select').selectOption('haiku')
    await form(app, '右クリックメニュー').locator('input').uncheck()

    await expect.poll(() => savedPrompts(app).at(-1)).toMatchObject({
      name: '一文で要約',
      body: '次のテキストを一文で要約してください。',
      defaultInput: 'wholeFile',
      model: 'haiku',
      showInContextMenu: false
    })
    expect(new Set(savedPrompts(app).map((p) => p.id)).size).toBe(4)

    // 右ドロワーのセレクトボックスにすぐ反映され、選ぶと既定の入力単位になる
    expect(await app.promptSelect.locator('option').allTextContents()).toEqual(['全体を要約', '段落を訳す', '語句を説明', '一文で要約', '自由入力'])
    await app.promptSelect.selectOption({ label: '一文で要約' })
    await expect(app.unit('ファイル全体')).toHaveClass(/active/)
    await app.runButton.click()
    const req = await app.run(1)
    expect(req.prompt.startsWith('次のテキストを一文で要約してください。')).toBe(true)
    expect(req.model).toBe('haiku')

    // 右クリックメニューには出ない
    await app.page.locator('.center-tabs .tab').first().click()
    await app.body.locator('p').first().click({ button: 'right' })
    expect(await app.contextMenuItems()).not.toContain('一文で要約')
  })

  test('PM-22 編集：既存のプロンプトを書き換えると、右ドロワーと右クリックメニューに反映される', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Short.md')
    await app.openSettings()
    await promptItems(app).nth(1).click()
    await expect(form(app, '名前').locator('input')).toHaveValue('段落を訳す')
    await form(app, '名前').locator('input').fill('段落を和訳')
    await form(app, 'モデル').locator('select').selectOption('opus')
    await expect.poll(() => savedPrompts(app)[1]).toMatchObject({ id: 'p-para', name: '段落を和訳', model: 'opus' })
    expect(await promptNames(app)).toEqual(['全体を要約', '段落を和訳', '語句を説明'])
    expect(await app.promptSelect.locator('option').allTextContents()).toEqual(['全体を要約', '段落を和訳', '語句を説明', '自由入力'])

    // モデルを「既定」に戻すと未指定になる
    await form(app, 'モデル').locator('select').selectOption('')
    await expect.poll(() => savedPrompts(app)[1].model).toBeNull()

    await app.page.locator('.center-tabs .tab').first().click()
    await app.body.locator('p').first().click({ button: 'right' })
    expect(await app.contextMenuItems()).toEqual(['段落を和訳', '語句を説明', 'コピー', 'ハイライト', 'ハイライト解除'])
  })

  test('PM-23 複製：選択中のプロンプトの直後に、同じ内容のコピーを作る', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.openSettings()
    await promptItems(app).nth(1).click()
    await listButton(app, '複製').click()
    await expect(promptItems(app)).toHaveCount(4)
    await expect.poll(() => savedPrompts(app).length).toBe(4)
    const [, original, copy] = savedPrompts(app)
    expect(copy.name).toContain('段落を訳す')
    expect(copy.name).not.toBe(original.name)
    expect(copy.id).not.toBe(original.id)
    expect({ ...copy, id: '', name: '' }).toEqual({ ...original, id: '', name: '' })
    expect(savedPrompts(app)[3].id).toBe('p-sel')
  })

  test('PM-24 削除：確認のうえ、選択中のプロンプトを一覧から消す', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.openSettings()
    await promptItems(app).nth(1).click()
    await listButton(app, '削除').click()
    expect(await app.confirms()).toHaveLength(1)
    expect((await app.confirms())[0]).toContain('段落を訳す')
    expect(await promptNames(app)).toEqual(['全体を要約', '語句を説明'])
    await expect.poll(() => savedPrompts(app).map((p) => p.id)).toEqual(['p-whole', 'p-sel'])
    expect(await app.promptSelect.locator('option').allTextContents()).toEqual(['全体を要約', '語句を説明', '自由入力'])
  })

  test('PM-25 並べ替え：一覧のドラッグ＆ドロップの順番が、セレクトボックスと右クリックメニューの並び順になる', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS.map((p) => ({ ...p, showInContextMenu: true })) } })
    await app.open('Short.md')
    await app.openSettings()
    await promptItems(app).first().scrollIntoViewIfNeeded()

    // 1 番目（全体を要約）を 3 番目の位置まで運ぶ
    const from = (await promptItems(app).nth(0).locator('.drag-handle').boundingBox())!
    const to = (await promptItems(app).nth(2).boundingBox())!
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
    const end = { x: start.x, y: to.y + to.height / 2 + 4 }
    await app.page.mouse.move(start.x, start.y)
    await app.page.mouse.down()
    await app.page.mouse.move(start.x, start.y + 8, { steps: 3 })
    await app.page.mouse.move(end.x, end.y, { steps: 12 })
    await app.page.mouse.move(end.x, end.y + 1)
    await app.page.mouse.up()

    await expect.poll(() => promptNames(app)).toEqual(['段落を訳す', '語句を説明', '全体を要約'])
    await expect.poll(() => savedPrompts(app).map((p) => p.id)).toEqual(['p-para', 'p-sel', 'p-whole'])
    expect(await app.promptSelect.locator('option').allTextContents()).toEqual(['段落を訳す', '語句を説明', '全体を要約', '自由入力'])

    await app.page.locator('.center-tabs .tab').first().click()
    await app.body.locator('p').first().click({ button: 'right' })
    expect(await app.contextMenuItems()).toEqual(['段落を訳す', '語句を説明', '全体を要約', 'コピー', 'ハイライト', 'ハイライト解除'])
  })

  test('PM-26 「初期プロンプトに戻す」で、仕様書の 11 件を復元する', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.openSettings()
    await listButton(app, '初期プロンプトに戻す').click()
    expect(await app.confirms()).toHaveLength(1)
    expect(await promptNames(app)).toEqual(DEFAULT_PROMPTS.map((p) => p.name))
    await expect.poll(() => savedPrompts(app)).toEqual(DEFAULT_PROMPTS)
    expect(await app.promptSelect.locator('option').allTextContents()).toEqual([...DEFAULT_PROMPTS.map((p) => p.name), '自由入力'])
  })
})

test.describe('設定 JSON', () => {
  test('JSON-30 設定は settings.json、読書位置などは state.json に保存される', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.scrollTo(300)
    await app.menu('CmdOrCtrl+D')
    await expect.poll(() => app.settingsOnDisk()?.layout.bottom.open).toBe(true)
    await app.settle()
    await app.quit()

    const settings = JSON.parse(fs.readFileSync(path.join(app.userData, 'settings.json'), 'utf8'))
    const state = JSON.parse(fs.readFileSync(path.join(app.userData, 'state.json'), 'utf8'))
    expect(Object.keys(settings).sort()).toEqual(['ai', 'layout', 'prompts', 'reader', 'save', 'speech', 'theme', 'vaultPath', 'version'])
    expect(settings.version).toBe(1)
    expect(state).toMatchObject({ version: 1, lastFile: 'Long.md', scroll: { 'Long.md': 300 } })
    expect(state).toHaveProperty('highlights')
    expect(state).toHaveProperty('treeOpen')
    expect(settings).not.toHaveProperty('scroll')
  })

  // 既知の不具合: ファイルを開いている間、スクロール位置の保存が約 0.4 秒ごとに繰り返し発生し続ける
  // （App の onScroll が appState.scroll に依存 → 保存のたびに onScroll が作り直される → Reader の effect が再実行される）。
  // state.json の書き出しは「最後の変更から 0.5 秒後」なので、いつまでも書き出されず、終了時にしか保存されない。
  test('JSON-32 読書位置は、アプリの終了を待たずに state.json に書き出される（異常終了しても失われない）', async ({ launch }) => {
    test.fail()
    const app = await launch()
    await app.open('Long.md')
    await app.scrollTo(300)
    await expect.poll(() => app.stateOnDisk()?.scroll['Long.md'], { timeout: 5000 }).toBe(300)
  })

  test('JSON-31 settings.json が壊れていたら settings.broken.json に退避し、既定値で起動する', async ({ launch }) => {
    const broken = '{ "version": 1, "vaultPath": "/somewhere", '
    const app = await launch({ rawSettings: broken })
    // 既定値で起動している（Vault 未設定、初期プロンプト）
    expect((await app.left.locator('.tree-empty').innerText()).replace(/\s+/g, '')).toContain('設定タブでVaultを指定してください')
    expect(await app.promptSelect.locator('option').allTextContents()).toEqual([...DEFAULT_PROMPTS.map((p) => p.name), '自由入力'])
    expect(fs.readFileSync(path.join(app.userData, 'settings.broken.json'), 'utf8')).toBe(broken)

    // そのまま使い続けられ、新しい設定が保存される
    await app.menu('CmdOrCtrl+D')
    await expect.poll(() => app.settingsOnDisk()?.layout.bottom.open).toBe(true)
    expect(app.settingsOnDisk()).toMatchObject({ version: 1, ai: DEFAULT_SETTINGS.ai, save: DEFAULT_SETTINGS.save })
  })
})
