// 仕様書「下ドロワー：AIの出力」「Claude連携：エラー表示」
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { expect, test, type App } from './support/app'
import { CLOSURE_PARAGRAPH, CUSTOM_PROMPTS } from './support/prompts'

const messages = (app: App) => app.bottom.locator('.chat-msg')
const answers = (app: App) => app.bottom.locator('.chat-msg.assistant')
const followUpInput = (app: App) => app.bottom.locator('.chat-input-row textarea')
const saveButton = (app: App) => app.bottom.getByRole('button', { name: '出力を保存' })

/** Short.md の段落を「段落を訳す」で実行する。 */
async function runParagraph(app: App): Promise<void> {
  if ((await app.body.count()) === 0) await app.open('Short.md')
  await app.body.locator('p', { hasText: 'A closure is a function' }).click()
  await app.promptSelect.selectOption({ label: '段落を訳す' })
  await app.runButton.click()
}

/** 保存されたファイルの一覧（Vault からの相対パス）。 */
function savedFiles(app: App, folder = 'AI Notes'): string[] {
  const dir = path.join(app.vaultPath, folder)
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

/** いま、または 1 分前の時刻から作られるファイル名のスタンプ（分をまたいだ場合に備える）。 */
function expectedStamps(): string[] {
  const fmt = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  }
  const now = new Date()
  return [fmt(now), fmt(new Date(now.getTime() - 60_000))]
}

const withPrompts = { settings: { prompts: CUSTOM_PROMPTS } }

test.describe('表示', () => {
  test('OUT-40 実行時に下ドロワーが閉じていれば自動で開く', async ({ launch }) => {
    const app = await launch(withPrompts)
    await expect(app.bottom).toHaveClass(/closed/)
    await runParagraph(app)
    await expect(app.bottom).toHaveClass(/open/)
    await expect(messages(app).first()).toContainText(CLOSURE_PARAGRAPH)
  })

  test('OUT-41 ストリーミングで逐次表示し、Markdown としてレンダリングする', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    const answer = answers(app).first()
    await expect(answer.locator('.spinner')).toBeVisible()

    await app.claude({ type: 'session', sessionId: 'sess-1' })
    await app.claude({ type: 'delta', text: 'クロージャとは、' })
    await expect(answer.locator('.chat-body')).toHaveText('クロージャとは、')
    await expect(answer.locator('.spinner')).toBeVisible() // まだ生成中

    await app.claude({ type: 'delta', text: '**定義された場所の変数**を覚えている関数です。' })
    await expect(answer.locator('.chat-body')).toHaveText('クロージャとは、定義された場所の変数を覚えている関数です。')
    await expect(answer.locator('.chat-body strong')).toHaveText('定義された場所の変数')

    await app.claude({ type: 'done' })
    await expect(answer.locator('.spinner')).toHaveCount(0)
    await expect(app.runButton).toBeEnabled()
  })

  test('OUT-42 本文ビューと同じレンダラーで、表・コード・Mermaid 図も描画する', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    await app.answer(
      [
        '## 図解',
        '',
        '| 用語 | 意味 |',
        '| --- | --- |',
        '| closure | クロージャ |',
        '',
        '```js',
        'const add = (a) => (b) => a + b',
        '```',
        '',
        '```mermaid',
        'graph LR',
        '  Outer[外側の関数] --> Inner[内側の関数]',
        '```',
        '',
        '00:12:34 ここは字幕の時刻。'
      ].join('\n')
    )
    const body = answers(app).first().locator('.chat-body')
    await expect(body.locator('h2')).toHaveText('図解')
    await expect(body.locator('table td').first()).toHaveText('closure')
    await expect(body.locator('pre.shiki')).toContainText('const add')
    await expect(body.locator('.mermaid-figure svg')).toBeVisible()
    await expect(body.locator('.mermaid-figure svg .node')).toHaveCount(2)
    await expect(body.locator('a.ts')).toHaveText('00:12:34')
  })

  test('OUT-43 AI の出力もサニタイズされ、スクリプトは実行されない', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    await app.answer('<script>window.__xss = 1</script>\n\n<img src=x onerror="window.__xss = 1">\n\n[x](javascript:window.__xss=1)\n\n安全な本文')
    const body = answers(app).first().locator('.chat-body')
    await expect(body).toContainText('安全な本文')
    await expect(body.locator('script, img, iframe')).toHaveCount(0)
    for (const a of await body.locator('a').all()) await a.click()
    expect(await app.page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined()
  })
})

test.describe('上書きと追加質問', () => {
  test('OUT-44 新しく実行すると、表示中の会話を破棄して置き換える（新しいセッションで始める）', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    await app.answer('最初の回答です。', 'sess-old')
    await expect(answers(app).first()).toContainText('最初の回答です。')

    // 右クリックメニューから実行しても置き換わる
    await app.body.locator('p', { hasText: 'quick brown fox' }).click({ button: 'right' })
    await app.contextMenu.getByText('段落を訳す').click()
    const second = await app.run(2)
    expect(second.resumeSessionId).toBeUndefined()
    await expect(messages(app)).toHaveCount(2)
    await expect(app.bottom).not.toContainText('最初の回答です。')
    await expect(messages(app).first()).toContainText('quick brown fox')

    // 置き換え前の実行のイベントが遅れて届いても混ざらない
    const first = (await app.runs())[0]
    await app.electron.evaluate(({ BrowserWindow }, runId) => BrowserWindow.getAllWindows()[0].webContents.send('claude:event', { runId, type: 'delta', text: '古い実行の続き' }), first.runId)
    await app.answer('二つ目の回答です。', 'sess-new')
    await expect(answers(app).first()).toContainText('二つ目の回答です。')
    await expect(app.bottom).not.toContainText('古い実行の続き')
  })

  test('OUT-45 追加質問：下部の入力欄から続けて質問でき、同じ Claude セッションを継続する', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS, ai: { defaultModel: 'haiku' } } })
    await runParagraph(app)
    const first = await app.run(1)
    await app.answer('最初の回答です。', 'sess-A')

    await followUpInput(app).fill('もう少し詳しく教えて')
    await followUpInput(app).press('Enter')
    const second = await app.run(2)
    expect(second.resumeSessionId).toBe('sess-A')
    expect(second.prompt).toBe('もう少し詳しく教えて')
    expect(second.model).toBe(first.model)
    await expect(followUpInput(app)).toHaveValue('')
    await app.answer('詳しい説明です。', 'sess-A')

    await followUpInput(app).fill('例を挙げて')
    await app.bottom.getByRole('button', { name: '送信' }).click()
    expect((await app.run(3)).resumeSessionId).toBe('sess-A')
    await app.answer('例はこちら。', 'sess-A')

    // やり取りは上から順に表示する
    await expect(messages(app)).toHaveCount(6)
    await expect(answers(app).nth(2)).toContainText('例はこちら。')
    const text = await app.bottom.locator('.chat-scroll').innerText()
    const order = [CLOSURE_PARAGRAPH, '最初の回答です。', 'もう少し詳しく教えて', '詳しい説明です。', '例を挙げて', '例はこちら。'].map((t) => text.indexOf(t))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('OUT-46 追加質問は、実行前と生成中にはできない。Shift+Enter は改行になる', async ({ launch }) => {
    const app = await launch(withPrompts)
    await app.menu('CmdOrCtrl+D')
    await expect(followUpInput(app)).toBeDisabled()

    await runParagraph(app)
    await app.run(1)
    await expect(followUpInput(app)).toBeDisabled() // 生成中
    await app.answer('回答です。')
    await expect(followUpInput(app)).toBeEnabled()

    await followUpInput(app).fill('1 行目')
    await followUpInput(app).press('Shift+Enter')
    await followUpInput(app).pressSequentially('2 行目')
    await expect(followUpInput(app)).toHaveValue('1 行目\n2 行目')
    expect(await app.runs()).toHaveLength(1)
  })

  test('OUT-47 履歴は残さない：再起動すると前の会話は表示されない', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    await app.answer('保存されないはずの回答')
    await expect(answers(app).first()).toContainText('保存されないはずの回答')

    await app.restart()
    await expect(app.bottom).toHaveClass(/open/)
    await expect(messages(app)).toHaveCount(0)
    for (const file of fs.readdirSync(app.userData).filter((f) => f.endsWith('.json'))) {
      expect(fs.readFileSync(path.join(app.userData, file), 'utf8'), file).not.toContain('保存されないはずの回答')
    }
  })
})

test.describe('停止とコピー', () => {
  test('OUT-48 生成中は「停止」ボタンで中断でき、それまでの出力は残る', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    await app.claude({ type: 'session', sessionId: 'sess-1' })
    await app.claude({ type: 'delta', text: '途中までの回答' })
    const stop = app.bottom.locator('.chat-input-row').getByRole('button', { name: '停止' })
    await expect(stop).toBeVisible()
    const before = await app.stops()
    await stop.click()
    await expect.poll(() => app.stops()).toBe(before + 1)

    await app.claude({ type: 'error', kind: 'aborted', message: '停止しました。' })
    await expect(stop).toHaveCount(0)
    await expect(answers(app).first()).toContainText('途中までの回答')
    await expect(answers(app).first()).toContainText('停止しました')
    await expect(app.bottom.locator('.chat-error')).toHaveCount(0) // エラー扱いにはしない
  })

  test('OUT-49 回答ごとのコピーボタンで、Markdown のままコピーする', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    const first = '## 訳\n\n**クロージャ**は関数です。\n\n- 点 1\n- 点 2'
    await app.answer(first)
    await followUpInput(app).fill('続けて')
    await followUpInput(app).press('Enter')
    await app.run(2)
    await app.answer('`二つ目`の回答')

    const copy = app.bottom.getByRole('button', { name: 'コピー' })
    await expect(copy).toHaveCount(2)
    await copy.nth(1).click()
    await copy.nth(0).click()
    expect(await app.clipboard()).toEqual(['`二つ目`の回答', first])
  })
})

test.describe('出力を保存', () => {
  test('OUT-50 表示中の会話を、保存先フォルダ（既定：AI Notes/）の新しい .md ファイルとして保存する', async ({ launch }) => {
    const app = await launch(withPrompts)
    const before = app.vaultSnapshot()
    await runParagraph(app)
    await app.run(1)
    await app.answer('**クロージャ**の訳です。')
    await saveButton(app).click()

    await expect.poll(() => savedFiles(app)).toHaveLength(1)
    const [name] = savedFiles(app)
    // ファイル名：{元ファイル名}_AI_{YYYYMMDD-HHmm}.md
    expect(expectedStamps().map((s) => `Short_AI_${s}.md`)).toContain(name)
    await expect(app.bottom).toContainText(`保存しました: AI Notes/${name}`)

    // 先頭に、元ファイルへのパス・プロンプト名・日時を frontmatter として記録する
    const raw = fs.readFileSync(path.join(app.vaultPath, 'AI Notes', name), 'utf8')
    expect(raw.startsWith('---\n')).toBe(true)
    const parsed = matter(raw)
    expect(parsed.data.source).toBe('Short.md')
    expect(parsed.data.prompt).toBe('段落を訳す')
    expect(Math.abs(Date.now() - new Date(parsed.data.date as string).getTime())).toBeLessThan(120_000)
    // 保存範囲の既定は会話全体（質問と回答）
    expect(parsed.content).toContain(CLOSURE_PARAGRAPH)
    expect(parsed.content).toContain('**クロージャ**の訳です。')

    // 保存後はツリーに反映される
    await expect(app.treeRow('AI Notes')).toBeVisible()
    await app.treeRow('AI Notes').click()
    await expect(app.treeRow(`AI Notes/${name}`)).toBeVisible()

    // 元ファイルへの追記や、ほかのファイルの変更は行わない
    const after = app.vaultSnapshot()
    expect(Object.keys(after).filter((k) => !(k in before))).toEqual([`AI Notes/${name}`])
    for (const [k, v] of Object.entries(before)) expect(after[k], k).toBe(v)
  })

  test('OUT-51 保存範囲「会話全体」では質問と回答をすべて、「最新の回答のみ」では最後の回答だけを保存する', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    await app.answer('最初の回答です。')
    await followUpInput(app).fill('もう少し詳しく')
    await followUpInput(app).press('Enter')
    await app.run(2)
    await app.answer('詳しい回答です。')

    await saveButton(app).click()
    await expect.poll(() => savedFiles(app)).toHaveLength(1)
    const wholeName = savedFiles(app)[0]
    const whole = matter(fs.readFileSync(path.join(app.vaultPath, 'AI Notes', wholeName), 'utf8')).content
    for (const t of [CLOSURE_PARAGRAPH, '最初の回答です。', 'もう少し詳しく', '詳しい回答です。']) expect(whole).toContain(t)

    await app.openSettings()
    await app.settingRow('保存範囲').locator('select').selectOption({ label: '最新の回答のみ' })
    await saveButton(app).click()
    await expect.poll(() => savedFiles(app)).toHaveLength(2)
    const latestName = savedFiles(app).find((f) => f !== wholeName) as string
    const latest = matter(fs.readFileSync(path.join(app.vaultPath, 'AI Notes', latestName), 'utf8')).content
    expect(latest.trim()).toBe('詳しい回答です。')
  })

  test('OUT-52 既存ファイルは上書きしない（同じ分に 2 回保存しても別のファイルになる）', async ({ launch }) => {
    const app = await launch(withPrompts)
    await runParagraph(app)
    await app.run(1)
    await app.answer('回答です。')
    await saveButton(app).click()
    await expect.poll(() => savedFiles(app)).toHaveLength(1)
    const first = savedFiles(app)[0]
    const firstContent = fs.readFileSync(path.join(app.vaultPath, 'AI Notes', first), 'utf8')

    await saveButton(app).click()
    await expect.poll(() => savedFiles(app)).toHaveLength(2)
    expect(fs.readFileSync(path.join(app.vaultPath, 'AI Notes', first), 'utf8')).toBe(firstContent)
    for (const f of savedFiles(app)) expect(f).toMatch(/^Short_AI_\d{8}-\d{4}(-\d+)?\.md$/)
  })

  test('OUT-53 保存先フォルダは設定タブで指定できる', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS, save: { folder: 'Notes/From AI' } } })
    await runParagraph(app)
    await app.run(1)
    await app.answer('回答です。')
    await saveButton(app).click()
    await expect.poll(() => savedFiles(app, 'Notes/From AI')).toHaveLength(1)
    expect(savedFiles(app)).toEqual([])
    await expect(app.treeRow('Notes')).toBeVisible()
  })

  test('OUT-54 保存先フォルダが Vault の外を指している場合は保存せず、失敗を表示する', async ({ launch }) => {
    const app = await launch({ settings: { prompts: CUSTOM_PROMPTS, save: { folder: '../outside' } } })
    await runParagraph(app)
    await app.run(1)
    await app.answer('回答です。')
    await saveButton(app).click()
    await expect(app.bottom).toContainText('保存に失敗')
    expect(fs.existsSync(path.join(app.root, 'outside'))).toBe(false)
  })

  test('OUT-55 回答がまだないとき・生成中は保存できない', async ({ launch }) => {
    const app = await launch(withPrompts)
    await app.menu('CmdOrCtrl+D')
    await expect(saveButton(app)).toBeDisabled()
    await runParagraph(app)
    await app.run(1)
    await app.claude({ type: 'delta', text: '生成中…' })
    await expect(saveButton(app)).toBeDisabled()
    await app.claude({ type: 'done' })
    await expect(saveButton(app)).toBeEnabled()
  })
})

test.describe('エラー表示', () => {
  const cases = [
    { kind: 'cli-not-found', message: 'Claude Code executable not found at /x/claude', title: /見つかりません/ },
    { kind: 'not-logged-in', message: 'Not logged in · Please run /login', title: /ログイン/ },
    { kind: 'usage-limit', message: 'Claude AI usage limit reached', title: /利用上限/ },
    { kind: 'timeout', message: '180秒間応答がなかったため中断しました。', title: /タイムアウト/ }
  ] as const

  for (const c of cases) {
    test(`CL-70 ${c.kind}：下ドロワーにわかる言葉で表示し、設定タブへのリンクを出す`, async ({ launch }) => {
      const app = await launch(withPrompts)
      await runParagraph(app)
      await app.run(1)
      await app.claude({ type: 'error', kind: c.kind, message: c.message })

      const error = app.bottom.locator('.chat-error')
      await expect(error.locator('.chat-error-title')).toHaveText(c.title)
      await expect(error.locator('details')).toContainText(c.message) // 元のメッセージは「詳細」に
      await expect(app.runButton).toBeEnabled() // もう一度実行できる

      await error.getByRole('button', { name: '設定タブを開く' }).click()
      await expect(app.page.locator('.settings')).toBeVisible()
    })
  }

  test('CL-71 claude のパスが間違っていると、実際の呼び出しが「CLI が見つからない」エラーになる', async ({ launch }) => {
    const app = await launch({ stubClaude: false, settings: { prompts: CUSTOM_PROMPTS, ai: { claudePath: '/nonexistent/bin/claude' } } })
    await runParagraph(app)
    const error = app.bottom.locator('.chat-error')
    await expect(error.locator('.chat-error-title')).toHaveText(/見つかりません/, { timeout: 30_000 })
    await expect(error.getByRole('button', { name: '設定タブを開く' })).toBeVisible()
    // Vault 内に .claude/ などを作らない
    expect(fs.readdirSync(app.vaultPath).filter((f) => f.startsWith('.claude'))).toEqual([])
  })
})
