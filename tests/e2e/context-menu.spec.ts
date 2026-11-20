// 仕様書「右クリックメニュー」
import { DEFAULT_PROMPTS } from '../../src/shared/types'
import { expect, test, type App } from './support/app'
import { CLOSURE_PARAGRAPH, CUSTOM_PROMPTS, FOX_PARAGRAPH } from './support/prompts'

const closure = (app: App) => app.body.locator('p', { hasText: 'A closure is a function' })

test.describe('右クリックメニュー', () => {
  test('CTX-01 プロンプト一覧（設定タブの並び順）、コピー、ハイライト、ハイライト解除を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await closure(app).click({ button: 'right' })
    await expect(app.contextMenu).toBeVisible()
    const expected = DEFAULT_PROMPTS.filter((p) => p.showInContextMenu).map((p) => p.name)
    expect(expected).toHaveLength(9)
    expect(await app.contextMenuItems()).toEqual([...expected, 'コピー', 'ハイライト', 'ハイライト解除'])
  })

  test('CTX-02 並び順と表示有無は設定に従う（右クリックメニューに表示しないプロンプトは出さない）', async ({ launch }) => {
    const app = await launch({ settings: { prompts: [CUSTOM_PROMPTS[2], CUSTOM_PROMPTS[0], CUSTOM_PROMPTS[1]] } })
    await app.open('Short.md')
    await closure(app).click({ button: 'right' })
    expect(await app.contextMenuItems()).toEqual(['語句を説明', '段落を訳す', 'コピー', 'ハイライト', 'ハイライト解除'])
  })

  test('CTX-03 未選択時は、選んだプロンプトを右クリックした段落を入力としてすぐ実行する', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Short.md')
    await closure(app).click({ button: 'right' })
    await app.contextMenu.getByText('段落を訳す').click()

    const req = await app.run(1)
    expect(req.prompt.startsWith('次の英文を訳してください。')).toBe(true)
    expect(req.prompt.endsWith(CLOSURE_PARAGRAPH)).toBe(true)
    await expect(app.contextMenu).toHaveCount(0)
    // 結果は下ドロワーに表示する（閉じていれば自動で開く）
    await expect(app.bottom).toHaveClass(/open/)
    await expect(app.bottom.locator('.chat-msg.user')).toContainText(CLOSURE_PARAGRAPH)
  })

  test('CTX-04 テキスト選択時は、選択範囲を入力としてすぐ実行する', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Short.md')
    await app.select('remembers the variables')
    await app.rightClickSelection()
    await app.contextMenu.getByText('語句を説明').click()

    const req = await app.run(1)
    expect(req.prompt.startsWith('次の語句を説明してください。')).toBe(true)
    expect(req.prompt.endsWith('remembers the variables')).toBe(true)
    expect(req.prompt).not.toContain(CLOSURE_PARAGRAPH)
    expect(req.model).toBe('opus') // プロンプトごとのモデル指定
  })

  test('CTX-05 右ドロワーで選んでいるプロンプトや入力単位に関係なく、選んだプロンプトで実行する', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS, ai: { defaultModel: 'haiku' } } })
    await app.open('Short.md')
    await app.promptSelect.selectOption({ label: '全体を要約' })
    await app.body.locator('p', { hasText: 'quick brown fox' }).click({ button: 'right' })
    await app.contextMenu.getByText('段落を訳す').click()
    const req = await app.run(1)
    expect(req.prompt.startsWith('次の英文を訳してください。')).toBe(true)
    expect(req.prompt.endsWith(FOX_PARAGRAPH)).toBe(true)
    expect(req.model).toBe('haiku') // モデル未指定のプロンプトは既定モデル
  })

  test('CTX-06 コピー：選択範囲をクリップボードにコピーする', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await app.select('lazy dog')
    await app.rightClickSelection()
    await app.contextMenu.getByText('コピー').click()
    expect(await app.clipboard()).toEqual(['lazy dog'])
    await expect(app.contextMenu).toHaveCount(0)
    expect(await app.runs()).toEqual([])
  })

  test('CTX-07 ハイライト／ハイライト解除：選択した語句にマーカーを付け、外せる', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await app.select('lazy dog')
    await app.rightClickSelection()
    await app.contextMenu.getByText('ハイライト', { exact: true }).click()
    await expect.poll(() => app.highlights('user-marks')).toEqual(['lazy dog'])

    await app.select('lazy dog')
    await app.rightClickSelection()
    await app.contextMenu.getByText('ハイライト解除').click()
    await expect.poll(() => app.highlights('user-marks')).toEqual([])
  })

  test('CTX-08 Esc やメニューの外のクリックで、何も実行せずに閉じる', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await closure(app).click({ button: 'right' })
    await expect(app.contextMenu).toBeVisible()
    await app.page.keyboard.press('Escape')
    await expect(app.contextMenu).toHaveCount(0)

    await closure(app).click({ button: 'right' })
    await expect(app.contextMenu).toBeVisible()
    await app.page.locator('.toolbar-title').click()
    await expect(app.contextMenu).toHaveCount(0)
    expect(await app.runs()).toEqual([])
  })

  test('CTX-09 見出しやリスト項目の上でも、その要素を段落として扱う', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Features.md')
    await app.body.locator('li', { hasText: 'todo item' }).click({ button: 'right' })
    await app.contextMenu.getByText('段落を訳す').click()
    const req = await app.run(1)
    expect(req.prompt.endsWith('todo item')).toBe(true)
  })
})
