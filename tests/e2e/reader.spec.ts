// 仕様書「中央：本文ビュー」（レンダリング、字幕のタイムスタンプ、読書体験）
import { expect, test } from './support/app'
import { FEATURES, TALK } from './support/vault'

test.describe('レンダリング', () => {
  test('MD-30 Markdown（表・タスクリスト・取り消し線・自動リンク）を描画する', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    await expect(app.body.locator('h1')).toHaveText('Features')
    await expect(app.body.locator('table th')).toHaveText(['Key', 'Action'])
    await expect(app.body.locator('table tbody tr')).toHaveCount(2)
    await expect(app.body.locator('li input[type="checkbox"]')).toHaveCount(2)
    await expect(app.body.locator('li input[type="checkbox"]').nth(1)).toBeChecked()
    await expect(app.body.locator('s, del')).toHaveText('wrong')
    await expect(app.body.locator('a[href="https://example.com/auto"]')).toBeVisible()
  })

  test('MD-31 コードブロックをシンタックスハイライトする', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    const pre = app.body.locator('pre.shiki')
    await expect(pre).toHaveCount(1)
    await expect(pre).toContainText('const answer: number = 42')
    const colors = await pre.locator('span[style]').evaluateAll((spans) => new Set(spans.map((s) => getComputedStyle(s).color)).size)
    expect(colors).toBeGreaterThan(1)
  })

  test('MD-32 ```mermaid ブロックを図として描画する', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    const figure = app.body.locator('.mermaid-figure')
    await expect(figure).toHaveCount(1)
    await expect(figure.locator('svg')).toBeVisible()
    await expect(figure.locator('svg .node')).toHaveCount(2)
    await expect(app.body.locator('pre.mermaid-block')).toHaveCount(0) // 元のコードのままでは残らない
  })

  // 既知の不具合: フローチャートのノードのラベルは <foreignObject> 内の HTML として出力されるが、
  // sanitizeSvg（DOMPurify）がその中身を取り除くため、箱だけが描かれて文字が出ない。
  test('MD-39 Mermaid 図のノードのラベル（文字）が表示される', async ({ launch }) => {
    test.fail()
    const app = await launch()
    await app.open('Features.md')
    const figure = app.body.locator('.mermaid-figure')
    await expect(figure.locator('svg')).toBeVisible()
    await expect(figure).toContainText('Start', { timeout: 4000 })
    await expect(figure).toContainText('Finish', { timeout: 4000 })
  })

  test('MD-33 Mermaid が構文エラーの場合は、エラー文と元のコードを表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    const error = app.body.locator('.mermaid-error')
    await expect(error).toHaveCount(1)
    await expect(error.locator('p')).toContainText('Mermaid')
    await expect(error.locator('pre')).toHaveText(/this is definitely not a diagram \(\(/)
    // エラーになっても、後ろの本文は表示される
    await expect(app.body).toContainText('Callout body.')
  })

  test('MD-34 frontmatter は本文に表示せず、タイトルとして使う', async ({ launch }) => {
    const app = await launch()
    await app.open('videos/Talk.md')
    await expect(app.page.locator('.toolbar-title')).toHaveText('Intro to Event Loops')
    await expect(app.body).not.toContainText('title:')
    await expect(app.body).not.toContainText('youtube.com')
    await expect(app.body).toContainText('Welcome to this talk')
  })

  test('MD-35 frontmatter にタイトルがなければファイル名を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('apple.md')
    await expect(app.page.locator('.toolbar-title')).toHaveText('apple')
  })

  test('MD-36 Obsidian 独自記法（[[wikilink]]、callout、![[埋め込み]]）は解釈せず、そのまま文字列として表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    await expect(app.body).toContainText('[[Other Note]]')
    await expect(app.body).toContainText('![[embedded.png]]')
    await expect(app.body).toContainText('[!note] Callout title')
    await expect(app.body.locator('img')).toHaveCount(0)
    await expect(app.body.locator('a', { hasText: 'Other Note' })).toHaveCount(0)
  })

  test('MD-37 外部 URL のリンクは既定のブラウザで開き、アプリ内では遷移しない', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    const url = app.page.url()
    await app.body.locator('a', { hasText: 'docs' }).click()
    await expect.poll(() => app.opened()).toEqual(['https://example.com/docs'])
    await app.body.locator('a[href="https://example.com/auto"]').click()
    await expect.poll(() => app.opened()).toEqual(['https://example.com/docs', 'https://example.com/auto'])
    expect(app.page.url()).toBe(url)
    expect(app.electron.windows()).toHaveLength(1)
    await expect(app.body.locator('h1')).toHaveText('Features')
  })

  test('MD-38 未対応の言語（Obsidian の ```dataview など）のコードブロックがあっても本文を表示できる', async ({ launch }) => {
    const md = '# Query\n\n```dataview\nTABLE file.name FROM "Books"\n```\n\n```ts\nconst after = 1\n```\n\nAfter the block.\n'
    const app = await launch({ vault: { 'Query.md': md } })
    await app.treeRow('Query.md').click()
    // ハイライトの準備が終わる（ts のブロックに色が付く）まで待ってから確かめる
    await expect(app.body.locator('pre.shiki')).toContainText('const after = 1', { timeout: 6000 })
    await expect(app.body.locator('h1')).toHaveText('Query')
    await expect(app.body).toContainText('TABLE file.name FROM "Books"')
    await expect(app.body).toContainText('After the block.')
  })
})

test.describe('字幕のタイムスタンプ', () => {
  test('TS-10 ツールバーのトグルでタイムスタンプの表示・非表示を切り替える', async ({ launch }) => {
    const app = await launch()
    await app.open('videos/Talk.md')
    const stamps = app.body.locator('a.ts')
    await expect(stamps).toHaveText(['00:00:05', '[00:12]', '00:12:34'])
    for (const s of await stamps.all()) await expect(s).toBeVisible()

    await app.page.getByTitle('タイムスタンプを隠す').click()
    for (const s of await stamps.all()) await expect(s).toBeHidden()
    await expect(app.body).toContainText('The event loop is what allows Node.js')

    await app.page.getByTitle('タイムスタンプを表示').click()
    for (const s of await stamps.all()) await expect(s).toBeVisible()
  })

  test('TS-11 非表示時は、タイムスタンプだけの行を詰めて文章を続けて読めるようにする', async ({ launch }) => {
    const app = await launch()
    await app.open('videos/Talk.md')
    const firstText = app.body.locator('p', { hasText: 'Welcome to this talk' })
    const before = (await firstText.boundingBox())!.y
    const onlyStamp = app.body.locator('p.ts-only')
    await expect(onlyStamp).toHaveCount(1)
    const stampHeight = (await onlyStamp.boundingBox())!.height

    await app.page.getByTitle('タイムスタンプを隠す').click()
    await expect(onlyStamp).toBeHidden()
    const after = (await firstText.boundingBox())!.y
    expect(before - after).toBeGreaterThanOrEqual(stampHeight) // 行ごと詰まる
    // 見えている文章にタイムスタンプが残らない
    expect(await app.body.innerText()).not.toMatch(/\d{1,2}:\d{2}/)
  })

  test('TS-12 設定「タイムスタンプの初期表示」がオフなら、開いた時点で非表示になっている', async ({ launch }) => {
    const app = await launch({ settings: { reader: { showTimestamps: false } } })
    await app.open('videos/Talk.md')
    await expect(app.body.locator('a.ts')).toHaveCount(3)
    for (const s of await app.body.locator('a.ts').all()) await expect(s).toBeHidden()
    await app.page.getByTitle('タイムスタンプを表示').click()
    await expect(app.body.locator('a.ts').first()).toBeVisible()
  })

  test('TS-13 frontmatter に動画 URL があれば、タイムスタンプのクリックでその時刻の YouTube をブラウザで開く', async ({ launch }) => {
    const app = await launch()
    await app.open('videos/Talk.md')
    await app.body.locator('a.ts', { hasText: '00:12:34' }).click()
    await app.body.locator('a.ts', { hasText: '[00:12]' }).click()
    await expect.poll(async () => (await app.opened()).length).toBe(2)
    const [first, second] = (await app.opened()).map((u) => new URL(u))
    expect(first.hostname).toBe('www.youtube.com')
    expect(first.searchParams.get('v')).toBe('abc123XYZ00')
    expect(first.searchParams.get('t')).toBe('754s')
    expect(second.searchParams.get('t')).toBe('12s')
    await expect(app.body.locator('h1, p').first()).toBeVisible() // アプリ内では遷移しない
  })

  test('TS-14 動画 URL のキーは url のほか source も既定で使える', async ({ launch }) => {
    const app = await launch({ vault: { 'Talk.md': TALK.replace('url: https://www.youtube.com/watch?v=abc123XYZ00', 'source: https://youtu.be/abc123XYZ00') } })
    await app.open('Talk.md')
    await app.body.locator('a.ts', { hasText: '00:12:34' }).click()
    await expect.poll(async () => (await app.opened()).length).toBe(1)
    const u = new URL((await app.opened())[0])
    expect(u.hostname).toBe('youtu.be')
    expect(u.pathname).toBe('/abc123XYZ00')
    expect(u.searchParams.get('t')).toBe('754s')
  })

  test('TS-15 動画 URL の frontmatter キー名は設定で指定できる', async ({ launch }) => {
    const vault = { 'Talk.md': TALK.replace('url: https://www.youtube.com/watch?v=abc123XYZ00', 'video: https://www.youtube.com/watch?v=custom00000') }
    const app = await launch({ vault })
    await app.open('Talk.md')
    await app.body.locator('a.ts', { hasText: '00:12:34' }).click()
    await app.openSettings()
    await app.settingRow('動画 URL の frontmatter キー').locator('input').fill('video, link')
    await expect.poll(() => app.settingsOnDisk()?.reader.videoUrlKeys).toEqual(['video', 'link'])
    expect(await app.opened()).toEqual([]) // 既定のキー（url, source）にはないので開かなかった

    await app.page.locator('.center-tabs .tab').first().click()
    await app.body.locator('a.ts', { hasText: '00:12:34' }).click()
    await expect.poll(() => app.opened()).toEqual(['https://www.youtube.com/watch?v=custom00000&t=754s'])
  })

  test('TS-16 動画 URL がないファイルでは、タイムスタンプをクリックしても何も開かない', async ({ launch }) => {
    const app = await launch({ vault: { 'NoUrl.md': '00:12:34 Just a transcript line.\n\nSecond paragraph.\n' } })
    await app.open('NoUrl.md')
    await app.body.locator('a.ts').click()
    await app.body.locator('p').nth(1).click()
    expect(await app.opened()).toEqual([])
    await expect(app.body).toContainText('Just a transcript line.')
  })
})

test.describe('表示設定', () => {
  test('READ-01 ツールバーのクイック設定から文字サイズ・行間・行幅・テーマを変更でき、即時に反映・保存される', async ({ launch }) => {
    const app = await launch({ settings: { theme: 'light' } })
    await app.open('Short.md')
    const para = app.body.locator('p').first()
    await expect(para).toHaveCSS('font-size', '17px')
    await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'light')

    await app.page.getByTitle('表示設定').click()
    const quick = app.page.locator('.popover.quick')
    await app.slide(quick.locator('label', { hasText: '文字サイズ' }).locator('input'), 22)
    await expect(para).toHaveCSS('font-size', '22px')
    await app.slide(quick.locator('label', { hasText: '行間' }).locator('input'), 2)
    await expect(para).toHaveCSS('line-height', '44px')
    await app.slide(quick.locator('label', { hasText: '行幅' }).locator('input'), 40)
    await expect(app.body).toHaveCSS('max-width', /px$/)
    const narrow = (await app.body.boundingBox())!.width
    await app.slide(quick.locator('label', { hasText: '行幅' }).locator('input'), 60)
    await expect.poll(async () => (await app.body.boundingBox())!.width).toBeGreaterThan(narrow)
    await quick.locator('select').selectOption('dark')
    await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await expect.poll(() => app.settingsOnDisk()?.reader).toMatchObject({ fontSize: 22, lineHeight: 2, maxLineWidthCh: 60 })
    await expect.poll(() => app.settingsOnDisk()?.theme).toBe('dark')
  })

  test('READ-02 設定タブから本文フォント・コードフォント・文字サイズ・行間・行幅を変更でき、本文に反映される', async ({ launch }) => {
    const app = await launch()
    await app.open('Features.md')
    await app.openSettings()
    await app.settingRow('本文フォント').locator('input').fill('Georgia')
    await app.settingRow('コードフォント').locator('input').fill('Courier New')
    await app.settingRow('文字サイズ (px)').locator('input').fill('20')
    await app.settingRow('行間').locator('input').fill('1.5')
    await app.settingRow('行幅 (ch)').locator('input').fill('50')
    await expect
      .poll(() => app.settingsOnDisk()?.reader)
      .toMatchObject({ fontFamily: 'Georgia', codeFontFamily: 'Courier New', fontSize: 20, lineHeight: 1.5, maxLineWidthCh: 50 })

    await app.page.locator('.center-tabs .tab').first().click()
    const para = app.body.locator('p').first()
    await expect(para).toHaveCSS('font-size', '20px')
    await expect(para).toHaveCSS('line-height', '30px')
    await expect(para).toHaveCSS('font-family', /Georgia/)
    await expect(app.body.locator('pre code').first()).toHaveCSS('font-family', /Courier New/)
  })

  test('READ-03 テーマ：ライト／ダークを選べ、システム連動では OS の設定に従う', async ({ launch }) => {
    const app = await launch({ settings: { theme: 'dark' } })
    const html = app.page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await app.openSettings()
    await app.settingRow('テーマ').locator('select').selectOption('light')
    await expect(html).toHaveAttribute('data-theme', 'light')

    await app.settingRow('テーマ').locator('select').selectOption('system')
    await app.page.emulateMedia({ colorScheme: 'dark' })
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await app.page.emulateMedia({ colorScheme: 'light' })
    await expect(html).toHaveAttribute('data-theme', 'light')
  })
})

test.describe('読書位置と進捗', () => {
  test('READ-04 ファイルごとにスクロール位置を保存し、再度開いたときに復元する', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.scrollTo(700)
    await app.settle()

    await app.open('Short.md')
    expect(await app.scrollTop()).toBe(0)
    await app.open('Long.md')
    await expect.poll(() => app.scrollTop()).toBe(700)
  })

  test('READ-05 読書位置はアプリを再起動しても復元される', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.scrollTo(450)
    await app.settle()
    await app.restart()
    expect(app.stateOnDisk()?.scroll['Long.md']).toBe(450)
    await expect(app.body.locator('h1')).toHaveText('Long Document')
    await expect.poll(() => app.scrollTop()).toBe(450)
  })

  test('READ-06 ツールバーに読了率（%）を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    const progress = app.page.locator('.toolbar-progress')
    await expect(progress).toHaveText('0%')
    const max = await app.scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
    await app.scrollTo(Math.round(max / 2))
    await expect(progress).toHaveText('50%')
    await app.scrollTo(max)
    await expect(progress).toHaveText('100%')
    await app.scrollTo(0)
    await expect(progress).toHaveText('0%')
  })

  test('READ-07 ファイルを開いていないときは読了率を表示しない', async ({ launch }) => {
    const app = await launch()
    await expect(app.page.locator('.toolbar-progress')).toHaveCount(0)
  })
})

test.describe('ファイル内検索', () => {
  test('READ-10 Cmd+F で検索バーを開き、一致箇所をハイライトする', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await expect(app.page.locator('.search-bar')).toHaveCount(0)
    await app.menu('CmdOrCtrl+F')
    const input = app.page.locator('.search-bar input')
    await expect(input).toBeFocused()
    await input.fill('needle')
    await expect(app.page.locator('.search-count')).toHaveText('1 / 4')
    expect(await app.highlights('search')).toEqual(['needle', 'needle', 'needle', 'Needle'])
    expect(await app.highlights('search-current')).toEqual(['needle'])
    // 本文の DOM は書き換えない（マーク用の要素を差し込まない）
    await expect(app.body.locator('mark')).toHaveCount(0)
  })

  test('READ-11 Enter で次、Shift+Enter で前の一致箇所へ移動し、その位置までスクロールする', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.menu('CmdOrCtrl+F')
    const input = app.page.locator('.search-bar input')
    const count = app.page.locator('.search-count')
    await input.fill('needle')
    await expect(count).toHaveText('1 / 4')

    await input.press('Enter')
    await expect(count).toHaveText('2 / 4')
    await input.press('Enter')
    await input.press('Enter')
    await expect(count).toHaveText('4 / 4')
    expect(await app.highlights('search-current')).toEqual(['Needle'])
    // 現在の一致箇所が見える位置までスクロールされている
    await expect(app.body.locator('p', { hasText: 'Needle with a capital letter.' })).toBeInViewport()

    await input.press('Enter') // 最後の次は先頭に戻る
    await expect(count).toHaveText('1 / 4')
    await input.press('Shift+Enter') // 先頭の前は最後
    await expect(count).toHaveText('4 / 4')
    await input.press('Shift+Enter')
    await expect(count).toHaveText('3 / 4')
  })

  test('READ-12 一致がなければ 0 件と表示し、検索バーを閉じるとハイライトが消える', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.menu('CmdOrCtrl+F')
    const input = app.page.locator('.search-bar input')
    await input.fill('zebra')
    await expect(app.page.locator('.search-count')).toHaveText('0 件')
    expect(await app.highlights('search')).toEqual([])

    await input.fill('needle')
    await expect(app.page.locator('.search-count')).toHaveText('1 / 4')
    await input.press('Escape')
    await expect(app.page.locator('.search-bar')).toHaveCount(0)
    expect(await app.highlights('search')).toEqual([])
    expect(await app.highlights('search-current')).toEqual([])
  })

  test('READ-13 設定タブを開いていても、Cmd+F で本文に戻って検索できる', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.openSettings()
    await app.menu('CmdOrCtrl+F')
    await expect(app.page.locator('.settings')).toHaveCount(0)
    await expect(app.page.locator('.search-bar input')).toBeFocused()
  })
})

test.describe('ハイライト（マーカー）', () => {
  test('READ-20 選択した語句をマーカー表示でき、ファイルには書き込まずアプリ内にのみ保存する', async ({ launch }) => {
    const app = await launch()
    const before = app.vaultSnapshot()
    await app.open('Short.md')
    await app.select('quick brown fox')
    await app.rightClickSelection()
    await app.contextMenu.getByText('ハイライト', { exact: true }).click()

    await expect.poll(() => app.highlights('user-marks')).toEqual(['quick brown fox'])
    await app.settle()
    await app.quit()
    expect(app.stateOnDisk()?.highlights['Short.md']).toEqual(['quick brown fox'])
    expect(app.vaultSnapshot()).toEqual(before)
  })

  test('READ-21 マーカーは再起動後も残り、別のファイルには表示されない', async ({ launch }) => {
    const app = await launch({ state: { highlights: { 'Short.md': ['closure'] } } })
    await app.open('Short.md')
    await expect.poll(() => app.highlights('user-marks')).toEqual(['closure', 'closure'])
    await app.open('Long.md')
    await expect.poll(() => app.highlights('user-marks')).toEqual([])

    await app.restart()
    await app.open('Short.md')
    await expect.poll(() => app.highlights('user-marks')).toEqual(['closure', 'closure'])
  })

  test('READ-22 ハイライト解除でマーカーを消せる', async ({ launch }) => {
    const app = await launch({ state: { highlights: { 'Short.md': ['quick brown fox', 'lazy dog'] } } })
    await app.open('Short.md')
    await expect.poll(async () => (await app.highlights('user-marks')).length).toBe(2)
    await app.select('quick brown fox')
    await app.rightClickSelection()
    await app.contextMenu.getByText('ハイライト解除').click()
    await expect.poll(() => app.highlights('user-marks')).toEqual(['lazy dog'])
    await app.settle()
    await app.quit()
    expect(app.stateOnDisk()?.highlights['Short.md']).toEqual(['lazy dog'])
  })
})

test.describe('見出しアウトライン', () => {
  test('READ-25 ツールバーから見出し一覧を開き、クリックでその見出しへ移動する', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.page.getByTitle('見出し一覧').click()
    const items = app.page.locator('.popover.outline .outline-item')
    await expect(items).toHaveCount(13)
    await expect(items.first()).toHaveText('Long Document')
    await expect(items.nth(9)).toHaveText('Section 9')

    const target = app.body.locator('h2', { hasText: /^Section 9$/ })
    await expect(target).not.toBeInViewport()
    await items.nth(9).click()
    await expect(target).toBeInViewport()
    await expect(app.page.locator('.popover.outline')).toHaveCount(0)
  })

  test('READ-26 見出しのないファイルでは、その旨を表示する', async ({ launch }) => {
    const app = await launch({ vault: { 'Flat.md': 'Just one paragraph without headings.\n' } })
    await app.open('Flat.md')
    await app.page.getByTitle('見出し一覧').click()
    await expect(app.page.locator('.popover.outline .outline-item')).toHaveCount(0)
    await expect(app.page.locator('.popover.outline')).toContainText('見出しがありません')
  })
})

test.describe('大きなファイル', () => {
  test('IMPL-10 数 MB の字幕ファイルでも固まらずに表示・検索できる', async ({ launch }) => {
    test.slow()
    const line = (i: number) => `${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} This is subtitle line number ${i} talking about the scheduler and the event loop.`
    const big = Array.from({ length: 25_000 }, (_, i) => line(i)).join('\n\n') + '\n\nThe very last line mentions a xylophone.\n'
    expect(big.length).toBeGreaterThan(2_000_000)
    const app = await launch({ vault: { 'Big.md': big, 'Small.md': FEATURES } })

    const opened = Date.now()
    await app.treeRow('Big.md').click()
    await expect(app.body.locator('p').first()).toContainText('subtitle line number 0', { timeout: 20_000 })
    expect(Date.now() - opened).toBeLessThan(20_000)

    await app.menu('CmdOrCtrl+F')
    const input = app.page.locator('.search-bar input')
    await input.fill('xylophone')
    await expect(app.page.locator('.search-count')).toHaveText('1 / 1', { timeout: 20_000 })
    // 操作を受け付ける（別のファイルに切り替えられる）
    await app.treeRow('Small.md').click()
    await expect(app.body.locator('h1')).toHaveText('Features', { timeout: 20_000 })
  })
})
