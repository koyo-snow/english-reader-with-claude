// 仕様書「右ドロワー：AIへの入力」（入力単位、プロンプト、実行、読み上げ）
import { DEFAULT_PROMPTS } from '../../src/shared/types'
import { expect, test, type App } from './support/app'
import { CLOSURE_PARAGRAPH, CUSTOM_PROMPTS, FOX_PARAGRAPH } from './support/prompts'
import { longDoc } from './support/vault'

const clickClosure = (app: App) => app.body.locator('p', { hasText: 'A closure is a function' }).click()
/** 読み上げ／停止ボタン（実行ボタンの左）。 */
const speechButton = (app: App) => app.right.locator('.run-row button').first()
/** 実行／停止ボタン。 */
const runOrStop = (app: App) => app.right.locator('.run-row button').last()

test.describe('入力単位', () => {
  test('IN-30 選択も段落の指定もないとき、選択範囲と段落はグレーアウトし、ホバーで理由を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    for (const label of ['選択範囲', '段落'] as const) {
      await expect(app.unit(label)).toBeDisabled()
      expect((await app.unit(label).getAttribute('title'))?.length).toBeGreaterThan(0)
    }
    await expect(app.unit('ファイル全体')).toBeEnabled()
    await expect(app.runButton).toBeDisabled()
    await expect(app.speakButton).toBeDisabled()
  })

  test('IN-31 段落：最後にクリックした段落を送る', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await app.body.locator('p', { hasText: 'quick brown fox' }).click()
    await clickClosure(app) // 最後にクリックしたほう
    await expect(app.unit('段落')).toBeEnabled()
    await app.unit('段落').click()
    await expect(app.preview).toHaveText(CLOSURE_PARAGRAPH)
    await app.runButton.click()
    expect((await app.run(1)).prompt.endsWith(CLOSURE_PARAGRAPH)).toBe(true)
  })

  test('IN-32 選択範囲：本文で選択中のテキストを送る', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await app.select('remembers the variables')
    await app.unit('選択範囲').click()
    await expect(app.preview).toHaveText('remembers the variables')
    await app.runButton.click()
    const req = await app.run(1)
    expect(req.prompt.endsWith('remembers the variables')).toBe(true)
    expect(req.prompt).not.toContain(CLOSURE_PARAGRAPH)
  })

  test('IN-33 選択範囲：何も選択していなければ、最後にクリックした段落を送る', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await app.unit('選択範囲').click()
    await expect(app.preview).toHaveText(CLOSURE_PARAGRAPH)
    await app.runButton.click()
    expect((await app.run(1)).prompt.endsWith(CLOSURE_PARAGRAPH)).toBe(true)
  })

  test('IN-34 ファイル全体：表示中ファイルの本文を frontmatter を除いて送る', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await app.unit('ファイル全体').click()
    await app.runButton.click()
    const req = await app.run(1)
    expect(req.prompt).toContain('# Short Note')
    expect(req.prompt).toContain(FOX_PARAGRAPH)
    expect(req.prompt).toContain('Second section paragraph about closures and scope.')
    expect(req.prompt).not.toContain('title: Short Note')
    expect(req.prompt).not.toContain('tags:')
  })

  test('IN-35 ファイル全体：本文が 1000 文字を超えるとグレーアウトし、ホバーで理由（上限と実際の文字数）を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    const button = app.unit('ファイル全体')
    await expect(button).toBeDisabled()
    const actual = longDoc().length
    expect(actual).toBeGreaterThan(1000)
    await expect(button).toHaveAttribute('title', new RegExp(`^本文が1,?000文字を超えるため使えません（${actual.toLocaleString('en-US')}文字）$`))
    // ファイル全体を既定とするプロンプトを選んでも実行できない
    await app.promptSelect.selectOption({ label: '要点を箇条書き' })
    await expect(app.runButton).toBeDisabled()
    await expect(app.speakButton).toBeDisabled()
  })

  test('IN-36 文字数の上限は設定タブで変更でき、すぐに反映される', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await expect(app.unit('ファイル全体')).toBeDisabled()
    await app.openSettings()
    await app.settingRow('ファイル全体の文字数上限').locator('input').fill('100000')
    await expect.poll(() => app.settingsOnDisk()?.ai.wholeFileCharLimit).toBe(100000)
    await app.page.locator('.center-tabs .tab').first().click()
    await expect(app.unit('ファイル全体')).toBeEnabled()
  })

  test('IN-37 送信前に、送る内容のプレビュー（先頭数行と文字数）とファイル名を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await app.unit('段落').click()
    const label = app.right.locator('.pane-section', { has: app.page.locator('.preview') }).locator('.label')
    await expect(label).toContainText(`${CLOSURE_PARAGRAPH.length}文字`)
    await expect(label).toContainText('Short.md')

    // 行数が多いときは先頭の数行だけ
    await app.unit('ファイル全体').click()
    const lines = app.preview.locator('.preview-line')
    await expect(lines.first()).toHaveText('# Short Note')
    expect(await lines.count()).toBeLessThanOrEqual(5)
    await expect(app.preview).not.toContainText('Second section paragraph')
  })

  test('IN-38 入力単位に関わらず、ファイル名を文脈として自動で添える', async ({ launch }) => {
    const app = await launch()
    await app.open('videos/Talk.md')
    await app.body.locator('p', { hasText: 'Welcome to this talk' }).click()
    const labels = ['段落', '選択範囲', 'ファイル全体'] as const
    for (const [i, label] of labels.entries()) {
      await app.unit(label).click()
      await app.runButton.click()
      expect((await app.run(i + 1)).prompt, label).toContain('Talk.md')
      await app.claude({ type: 'done' })
    }
  })
})

test.describe('プロンプト', () => {
  test('PR-30 セレクトボックスに、登録したプロンプトを設定タブの並び順で表示する（最後に自由入力）', async ({ launch }) => {
    const app = await launch()
    expect(await app.promptSelect.locator('option').allTextContents()).toEqual([...DEFAULT_PROMPTS.map((p) => p.name), '自由入力'])

    const custom = await launch({ settings: { prompts: [CUSTOM_PROMPTS[2], CUSTOM_PROMPTS[0], CUSTOM_PROMPTS[1]] } })
    expect(await custom.promptSelect.locator('option').allTextContents()).toEqual(['語句を説明', '全体を要約', '段落を訳す', '自由入力'])
  })

  test('PR-31 プロンプトを選ぶと既定の入力単位が自動で選ばれ、手動でも変更できる', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Short.md')
    await clickClosure(app)
    await expect(app.unit('ファイル全体')).toHaveClass(/active/) // 先頭のプロンプトの既定

    await app.promptSelect.selectOption({ label: '段落を訳す' })
    await expect(app.unit('段落')).toHaveClass(/active/)
    await app.promptSelect.selectOption({ label: '語句を説明' })
    await expect(app.unit('選択範囲')).toHaveClass(/active/)

    await app.unit('ファイル全体').click() // 手動で変更
    await expect(app.unit('ファイル全体')).toHaveClass(/active/)
    await expect(app.unit('選択範囲')).not.toHaveClass(/active/)
    await app.runButton.click()
    const req = await app.run(1)
    expect(req.prompt.startsWith('次の語句を説明してください。')).toBe(true)
    expect(req.prompt).toContain('# Short Note')
  })

  test('PR-32 送信形式：プロンプト本文の後に、区切り線と入力テキストをつないで送る', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Short.md')
    await clickClosure(app)
    await app.promptSelect.selectOption({ label: '段落を訳す' })
    await app.runButton.click()
    const { prompt } = await app.run(1)
    const lines = prompt.split('\n')
    expect(lines[0]).toBe('次の英文を訳してください。')
    expect(lines).toContain('---')
    expect(lines.at(-1)).toBe(CLOSURE_PARAGRAPH)
    expect(prompt.indexOf('次の英文を訳してください。')).toBeLessThan(prompt.indexOf('\n---\n'))
    expect(prompt.indexOf('\n---\n')).toBeLessThan(prompt.indexOf(CLOSURE_PARAGRAPH))
    expect(prompt).not.toMatch(/\{\{.*?\}\}/)
  })

  test('PR-33 モデル：プロンプトごとの指定を使い、未指定なら設定タブの既定モデルを使う', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS, ai: { defaultModel: 'haiku' } } })
    await app.open('Short.md')
    await clickClosure(app)
    await app.promptSelect.selectOption({ label: '語句を説明' })
    await expect(app.right).toContainText('opus')
    await app.runButton.click()
    expect((await app.run(1)).model).toBe('opus')
    await app.claude({ type: 'done' })

    await app.promptSelect.selectOption({ label: '段落を訳す' })
    await app.runButton.click()
    expect((await app.run(2)).model).toBe('haiku')
  })

  test('PR-34 自由入力：選ぶとテキストエリアが有効になり、書いた指示で実行できる', async ({ launch }) => {
    const app = await launch({ settings: { ai: { defaultModel: 'opus' } } })
    await app.open('Short.md')
    await clickClosure(app)
    await expect(app.right.locator('textarea')).toHaveCount(0)
    await app.promptSelect.selectOption({ label: '自由入力' })
    const free = app.right.locator('textarea')
    await expect(free).toBeVisible()
    await expect(app.runButton).toBeDisabled() // 指示が空では実行できない

    await free.fill('この段落を小学生にもわかるように説明して')
    await expect(app.runButton).toBeEnabled()
    await app.runButton.click()
    const req = await app.run(1)
    expect(req.prompt.startsWith('この段落を小学生にもわかるように説明して')).toBe(true)
    expect(req.prompt.endsWith(CLOSURE_PARAGRAPH)).toBe(true)
    expect(req.model).toBe('opus')
  })

  test('PR-35 実行中は「停止」ボタンに切り替わり、押すと生成を止める', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await expect(runOrStop(app)).toContainText('実行')
    await app.runButton.click()
    await app.run(1)
    await expect(runOrStop(app)).toHaveText('停止')

    const before = await app.stops()
    await runOrStop(app).click()
    await expect.poll(() => app.stops()).toBe(before + 1)
    await app.claude({ type: 'error', kind: 'aborted', message: '停止しました。' })
    await expect(runOrStop(app)).toContainText('実行')
  })

  test('PR-36 Cmd+Enter で右ドロワーのプロンプトを実行する', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS } })
    await app.open('Short.md')
    await clickClosure(app)
    await app.promptSelect.selectOption({ label: '段落を訳す' })
    await app.menu('CmdOrCtrl+Enter')
    const req = await app.run(1)
    expect(req.prompt.startsWith('次の英文を訳してください。')).toBe(true)
    expect(req.prompt.endsWith(CLOSURE_PARAGRAPH)).toBe(true)
  })

  test('PR-37 入力単位が使えない状態では、Cmd+Enter でも実行されない', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await app.menu('CmdOrCtrl+Enter')
    await app.menu('CmdOrCtrl+D') // メニュー操作が処理されたことの確認用
    await expect(app.bottom).toHaveClass(/open/)
    expect(await app.runs()).toEqual([])
  })
})

test.describe('読み上げ', () => {
  test('SP-50 「読み上げ」は「実行」の左にあり、選択中の入力単位の文章を読み上げる（Claude には送らない）', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await app.unit('段落').click()
    const speak = (await app.speakButton.boundingBox())!
    const run = (await app.runButton.boundingBox())!
    expect(speak.x + speak.width).toBeLessThanOrEqual(run.x)

    await app.speakButton.click()
    await expect.poll(() => app.speaks()).toEqual([CLOSURE_PARAGRAPH])
    expect(await app.runs()).toEqual([])
    await expect(app.bottom).toHaveClass(/closed/)
  })

  test('SP-51 読み上げ中は「停止」ボタンに切り替わり、押すと止まる。読み終わると元に戻る', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await app.speakButton.click()
    await expect(speechButton(app)).toHaveText('停止')
    await speechButton(app).click()
    await expect.poll(() => app.speechStops()).toBe(1)
    await expect(speechButton(app)).toHaveText('読み上げ')

    await app.speakButton.click()
    await expect(speechButton(app)).toHaveText('停止')
    await app.speechState({ speaking: false }) // 最後まで読み終えた
    await expect(speechButton(app)).toHaveText('読み上げ')
  })

  test('SP-52 選択範囲やファイル全体を選べば、その文章を読み上げる', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await app.select('remembers the variables')
    await app.unit('選択範囲').click()
    await app.speakButton.click()
    await expect.poll(() => app.speaks()).toEqual(['remembers the variables'])
    await app.speechState({ speaking: false })

    await app.unit('ファイル全体').click()
    await app.speakButton.click()
    await expect.poll(async () => (await app.speaks()).length).toBe(2)
    const whole = (await app.speaks())[1]
    expect(whole).toContain(FOX_PARAGRAPH)
    expect(whole).not.toContain('title: Short Note')
  })

  test('SP-53 読み上げ速度：スライダーで 0.3×〜3.0×（0.1 刻み）を選べ、設定（speech.rate）に保存される', async ({ launch }) => {
    const app = await launch()
    const slider = app.right.getByLabel('読み上げ速度')
    await expect(slider).toHaveAttribute('min', '0.3')
    await expect(slider).toHaveAttribute('max', '3')
    await expect(slider).toHaveAttribute('step', '0.1')
    const value = app.right.locator('.rate-value')
    await expect(value).toHaveText('1.0×')

    // スライダーは読み上げボタンの上にある
    expect((await slider.boundingBox())!.y).toBeLessThan((await app.speakButton.boundingBox())!.y)

    await app.slide(slider, 1.5)
    await expect(value).toHaveText('1.5×')
    await expect.poll(() => app.settingsOnDisk()?.speech.rate).toBe(1.5)
    await app.slide(slider, 3)
    await expect(value).toHaveText('3.0×')
    await app.slide(slider, 0.3)
    await expect(value).toHaveText('0.3×')
    await expect.poll(() => app.settingsOnDisk()?.speech.rate).toBe(0.3)
  })

  test('SP-54 倍率の表示をクリックすると 1.0× に戻る', async ({ launch }) => {
    const app = await launch({ settings: { speech: { rate: 2.2 } } })
    const value = app.right.locator('.rate-value')
    await expect(value).toHaveText('2.2×')
    await value.click()
    await expect(value).toHaveText('1.0×')
    await expect(app.right.getByLabel('読み上げ速度')).toHaveValue('1')
    await expect.poll(() => app.settingsOnDisk()?.speech.rate).toBe(1)
  })

  test('SP-55 読み上げに失敗したら、その内容を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await clickClosure(app)
    await app.speakButton.click()
    await app.speechState({ speaking: false, error: 'say を起動できません: ENOENT' })
    await expect(app.right.locator('.speech-error')).toHaveText('say を起動できません: ENOENT')
    await expect(speechButton(app)).toHaveText('読み上げ')
  })
})
