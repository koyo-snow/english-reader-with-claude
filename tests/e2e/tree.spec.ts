// 仕様書「左ドロワー：ファイルツリー」
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/app'
import { longDoc } from './support/vault'

test.describe('表示対象と並び順', () => {
  test('TREE-30 フォルダと .md だけを、フォルダ → ファイルの順・名前の昇順で表示する（隠しファイルと .md のないフォルダは出さない）', async ({ launch }) => {
    const app = await launch()
    expect(await app.treeNames()).toEqual(['Books', 'videos', 'apple', 'Banana', 'Features', 'Long', 'Short'])
    const text = await app.left.locator('.tree-body').innerText()
    for (const hidden of ['.obsidian', '.trash', '.hidden', 'Empty', 'Nested', 'cover', 'notes']) expect(text).not.toContain(hidden)
  })

  test('TREE-31 フォルダのクリックで開閉し、中のファイルは数字の自然順で並ぶ', async ({ launch }) => {
    const app = await launch()
    await app.treeRow('Books').click()
    expect(await app.treeNames()).toEqual(['Books', 'Chapter 1', 'Chapter 2', 'Chapter 10', 'videos', 'apple', 'Banana', 'Features', 'Long', 'Short'])
    await app.treeRow('Books').click()
    expect(await app.treeNames()).toEqual(['Books', 'videos', 'apple', 'Banana', 'Features', 'Long', 'Short'])
  })

  test('TREE-32 ファイルのクリックで中央に本文を表示する', async ({ launch }) => {
    const app = await launch()
    await expect(app.page.locator('.reader-empty')).toBeVisible()
    await app.treeRow('Books').click()
    await app.treeRow('Books/Chapter 2.md').click()
    await expect(app.body.locator('h1')).toHaveText('Chapter 2')
    await expect(app.body).toContainText('Second chapter text.')
    await expect(app.treeRow('Books/Chapter 2.md')).toHaveClass(/active/)
    await expect(app.page.locator('.center-tabs .tab.active')).toHaveText('Chapter 2')
  })
})

test.describe('状態の記憶', () => {
  test('TREE-33 フォルダの開閉状態と最後に開いたファイルを記憶し、次回起動時に復元する', async ({ launch }) => {
    const app = await launch()
    await app.treeRow('videos').click()
    await app.treeRow('Books').click()
    await app.treeRow('Books/Chapter 10.md').click()
    await expect(app.body.locator('h1')).toHaveText('Chapter 10')
    await app.settle()

    await app.restart()
    expect(app.stateOnDisk()?.lastFile).toBe('Books/Chapter 10.md')
    expect([...(app.stateOnDisk()?.treeOpen ?? [])].sort()).toEqual(['Books', 'videos'])
    await expect(app.body.locator('h1')).toHaveText('Chapter 10')
    await expect(app.treeRow('Books/Chapter 10.md')).toHaveClass(/active/)
    await expect(app.treeRow('videos/Talk.md')).toBeVisible()
  })

  test('TREE-34 起動時に前回の Vault を開く', async ({ launch }) => {
    const app = await launch()
    await app.restart()
    expect(await app.treeNames()).toEqual(['Books', 'videos', 'apple', 'Banana', 'Features', 'Long', 'Short'])
  })
})

test.describe('ツリー内の絞り込み', () => {
  test('TREE-35 ファイル名で絞り込める（大文字小文字を区別せず、閉じたフォルダの中も対象）', async ({ launch }) => {
    const app = await launch()
    const filter = app.left.locator('.tree-filter')
    await filter.fill('CHAP')
    expect(await app.treeNames()).toEqual(['Books', 'Chapter 1', 'Chapter 2', 'Chapter 10'])
    await filter.fill('an')
    expect(await app.treeNames()).toEqual(['Banana'])
    await filter.fill('')
    expect(await app.treeNames()).toEqual(['Books', 'videos', 'apple', 'Banana', 'Features', 'Long', 'Short'])
  })

  test('TREE-36 絞り込み結果からファイルを開ける。一致がなければその旨を表示する', async ({ launch }) => {
    const app = await launch()
    const filter = app.left.locator('.tree-filter')
    await filter.fill('talk')
    await app.treeRow('videos/Talk.md').click()
    await expect(app.body).toContainText('Welcome to this talk')
    await filter.fill('no-such-file')
    expect(await app.treeNames()).toEqual([])
    await expect(app.left.locator('.tree-empty')).toBeVisible()
  })
})

test.describe('ファイル監視', () => {
  test('TREE-37 Vault へのファイル追加・削除・名前変更をツリーに反映する', async ({ launch }) => {
    const app = await launch()
    app.writeVault('Added.md', '# Added\n')
    await expect(app.treeRow('Added.md')).toBeVisible()

    fs.renameSync(path.join(app.vaultPath, 'Added.md'), path.join(app.vaultPath, 'Renamed.md'))
    await expect(app.treeRow('Renamed.md')).toBeVisible()
    await expect(app.treeRow('Added.md')).toHaveCount(0)

    fs.rmSync(path.join(app.vaultPath, 'Renamed.md'))
    await expect(app.treeRow('Renamed.md')).toHaveCount(0)
  })

  test('TREE-38 .md が入ったフォルダの追加で、非表示だったフォルダが現れる', async ({ launch }) => {
    const app = await launch()
    await expect(app.treeRow('Empty')).toHaveCount(0)
    app.writeVault('Empty/now-has.md', '# md\n')
    await expect(app.treeRow('Empty')).toBeVisible()
    app.writeVault('Brand New/first.md', '# first\n')
    await expect(app.treeRow('Brand New')).toBeVisible()
  })

  test('TREE-39 隠しフォルダや .md 以外のファイルが増えてもツリーには出ない', async ({ launch }) => {
    const app = await launch()
    app.writeVault('.obsidian/workspace.json', '{}')
    app.writeVault('picture.png', 'x')
    app.writeVault('Marker.md', '# marker\n')
    await expect(app.treeRow('Marker.md')).toBeVisible()
    expect(await app.treeNames()).toEqual(['Books', 'videos', 'apple', 'Banana', 'Features', 'Long', 'Marker', 'Short'])
  })

  test('TREE-40 表示中のファイルが外部で変更されたら本文を再読み込みし、スクロール位置を保つ', async ({ launch }) => {
    const app = await launch()
    await app.open('Long.md')
    await app.scrollTo(600)
    expect(await app.scrollTop()).toBe(600)

    app.writeVault('Long.md', longDoc().replace('Intro paragraph about scheduling.', 'Intro paragraph EDITED IN OBSIDIAN.'))
    await expect(app.body).toContainText('EDITED IN OBSIDIAN')
    await expect(app.body).not.toContainText('Intro paragraph about scheduling.')
    expect(await app.scrollTop()).toBe(600)
  })

  test('TREE-41 表示中のファイルが削除されたら空の状態に戻し、その旨を表示する', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    await expect(app.body).toContainText('quick brown fox')
    fs.rmSync(path.join(app.vaultPath, 'Short.md'))
    await expect(app.body).toHaveCount(0)
    await expect(app.page.locator('.reader-empty')).toContainText('削除')
    await expect(app.treeRow('Short.md')).toHaveCount(0)
  })

  test('TREE-42 表示中でないファイルが変更されても、表示中の本文は変わらない', async ({ launch }) => {
    const app = await launch()
    await app.open('Short.md')
    app.writeVault('apple.md', '# apple changed\n')
    app.writeVault('Signal.md', '# signal\n')
    await expect(app.treeRow('Signal.md')).toBeVisible()
    await expect(app.body.locator('h1')).toHaveText('Short Note')
  })
})

test.describe('Vault の指定とエラー', () => {
  test('TREE-43 Vault パスが存在しない場合は、ツリーの代わりに「設定タブでVaultを指定してください」と表示する', async ({ launch }) => {
    const app = await launch({ vault: null })
    await expect(app.left.locator('.tree-row')).toHaveCount(0)
    const message = (await app.left.locator('.tree-empty').innerText()).replace(/\s+/g, '')
    expect(message).toContain('設定タブでVaultを指定してください')
    await app.left.getByText('設定タブで').click()
    await expect(app.page.locator('.settings')).toBeVisible()
  })

  test('TREE-44 Vault が未設定（初回起動）でも同じ案内を表示する', async ({ launch }) => {
    const app = await launch({ vault: null, settings: { vaultPath: '' } })
    expect((await app.left.locator('.tree-empty').innerText()).replace(/\s+/g, '')).toContain('設定タブでVaultを指定してください')
  })

  test('TREE-45 設定タブのフォルダ選択ボタンで Vault を指定すると、ツリーが表示され、値が JSON に保存される', async ({ launch }) => {
    const app = await launch({ settings: { vaultPath: '' } })
    await expect(app.left.locator('.tree-row')).toHaveCount(0)
    await app.setDialogResult(app.vaultPath)
    await app.openSettings()
    await app.settingRow('Vault パス').getByRole('button', { name: '選択…' }).click()
    await expect(app.settingRow('Vault パス').locator('input')).toHaveValue(app.vaultPath)
    await expect(app.treeRow('Books')).toBeVisible()
    await expect.poll(() => app.settingsOnDisk()?.vaultPath).toBe(app.vaultPath)
  })

  test('TREE-46 設定タブのパス入力欄に入力して Vault を切り替えられる', async ({ launch }) => {
    const app = await launch()
    const other = path.join(app.root, 'other-vault')
    fs.mkdirSync(other)
    fs.writeFileSync(path.join(other, 'Only.md'), '# Only\n')
    await app.open('Short.md')
    await app.openSettings()
    await app.settingRow('Vault パス').locator('input').fill(other)
    await expect.poll(() => app.treeNames()).toEqual(['Only'])
    // 切り替え後は、前の Vault のファイルを表示し続けない
    await app.page.locator('.center-tabs .tab').first().click()
    await expect(app.body).toHaveCount(0)
    // 新しい Vault も監視される
    fs.writeFileSync(path.join(other, 'Second.md'), '# Second\n')
    await expect(app.treeRow('Second.md')).toBeVisible()
  })

  test('TREE-47 .md が 1 つもない Vault では、その旨を表示する', async ({ launch }) => {
    const app = await launch({ vault: { 'readme.txt': 'no markdown' } })
    await expect(app.left.locator('.tree-row')).toHaveCount(0)
    await expect(app.left.locator('.tree-empty')).toBeVisible()
    expect(await app.left.locator('.tree-empty').innerText()).not.toContain('設定タブ')
  })
})
