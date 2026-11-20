// 仕様書「画面構成」「ドロワーの動作」「ショートカット」
import { expect, test, type App } from './support/app'
import { DRAWER_LIMITS } from '../../src/shared/types'

const width = async (app: App, side: 'left' | 'right') => (await app[side].boundingBox())?.width ?? -1
const height = async (app: App) => (await app.bottom.boundingBox())?.height ?? -1

/** ドロワーの境界をつかんで dx / dy だけ動かす。 */
async function drag(app: App, side: 'left' | 'right' | 'bottom', dx: number, dy: number): Promise<void> {
  const box = await app.page.locator(`.handle-${side}`).boundingBox()
  if (!box) throw new Error('境界が見つかりません')
  // 中央には開閉ボタンがあるので、端に近い位置をつかむ
  const x = side === 'bottom' ? box.x + 40 : box.x + box.width / 2
  const y = side === 'bottom' ? box.y + box.height / 2 : box.y + 60
  await app.page.mouse.move(x, y)
  await app.page.mouse.down()
  await app.page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await app.page.mouse.move(x + dx, y + dy, { steps: 4 })
  await app.page.mouse.up()
}

test.describe('画面構成', () => {
  test('LAY-01 上段に左ドロワー・本文ビュー・右ドロワーが並び、その下に画面幅いっぱいの下ドロワーがある', async ({ launch }) => {
    const app = await launch({ settings: { layout: { bottom: { open: true } } } })
    const left = (await app.left.boundingBox())!
    const center = (await app.page.locator('.center').boundingBox())!
    const right = (await app.right.boundingBox())!
    const bottom = (await app.bottom.boundingBox())!
    const viewport = await app.page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))

    expect(left.x).toBe(0)
    expect(center.x).toBeGreaterThanOrEqual(left.x + left.width)
    expect(right.x).toBeGreaterThanOrEqual(center.x + center.width - 1)
    expect(Math.round(right.x + right.width)).toBe(viewport.w)
    // 上段の 3 つは同じ高さに並ぶ
    expect(center.y).toBe(left.y)
    expect(right.y).toBe(left.y)
    // 下ドロワーは上段の下、幅いっぱい
    expect(bottom.y).toBeGreaterThanOrEqual(left.y + left.height - 1)
    expect(bottom.x).toBe(0)
    expect(Math.round(bottom.width)).toBe(viewport.w)
    expect(Math.round(bottom.y + bottom.height)).toBe(viewport.h)
  })

  test('LAY-02 初回起動時は左右のドロワーが開き、下ドロワーは閉じている', async ({ launch }) => {
    const app = await launch()
    await expect(app.left).toHaveClass(/open/)
    await expect(app.right).toHaveClass(/open/)
    await expect(app.bottom).toHaveClass(/closed/)
    expect(await width(app, 'left')).toBe(260)
    expect(await width(app, 'right')).toBe(320)
    expect(await height(app)).toBeLessThanOrEqual(1)
  })
})

test.describe('ドロワーの開閉', () => {
  for (const side of ['left', 'right', 'bottom'] as const) {
    test(`LAY-03 ${side}：境界のボタンで開閉する`, async ({ launch }) => {
      const app = await launch({ settings: { layout: { bottom: { open: true } } } })
      const drawer = app[side]
      const toggle = drawer.locator('.drawer-toggle')
      await expect(drawer).toHaveClass(/open/)
      await toggle.click()
      await expect(drawer).toHaveClass(/closed/)
      const box = (await drawer.boundingBox())!
      expect(side === 'bottom' ? box.height : box.width).toBeLessThanOrEqual(1)
      await toggle.click()
      await expect(drawer).toHaveClass(/open/)
    })
  }

  test('KEY-10 Cmd+L / Cmd+R / Cmd+D でそれぞれ左・右・下ドロワーを開閉する', async ({ launch }) => {
    const app = await launch()
    await app.menu('CmdOrCtrl+L')
    await expect(app.left).toHaveClass(/closed/)
    await expect(app.right).toHaveClass(/open/)
    await app.menu('CmdOrCtrl+L')
    await expect(app.left).toHaveClass(/open/)

    await app.menu('CmdOrCtrl+R')
    await expect(app.right).toHaveClass(/closed/)
    await expect(app.left).toHaveClass(/open/)
    await app.menu('CmdOrCtrl+R')
    await expect(app.right).toHaveClass(/open/)

    await app.menu('CmdOrCtrl+D')
    await expect(app.bottom).toHaveClass(/open/)
    await app.menu('CmdOrCtrl+D')
    await expect(app.bottom).toHaveClass(/closed/)
  })

  test('KEY-11 Cmd+R はページの再読み込みではなく右ドロワーの開閉に割り当てられている', async ({ launch }) => {
    const app = await launch()
    const items = await app.menuItems()
    expect(items.map((i) => i.role.toLowerCase())).not.toContain('reload')
    expect(items.map((i) => i.role.toLowerCase())).not.toContain('forcereload')
    expect(items.filter((i) => i.accelerator.toLowerCase() === 'cmdorctrl+r')).toHaveLength(1)

    // 再読み込みされていないことを、ページ上に置いた印が残っていることで確かめる
    await app.page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1))
    await app.menu('CmdOrCtrl+R')
    await expect(app.right).toHaveClass(/closed/)
    expect(await app.page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(1)
  })

  test('KEY-12 仕様書のショートカットがすべてアプリのメニューに登録されている', async ({ launch }) => {
    const app = await launch()
    const accelerators = (await app.menuItems()).map((i) => i.accelerator.toLowerCase())
    for (const key of ['CmdOrCtrl+L', 'CmdOrCtrl+R', 'CmdOrCtrl+D', 'CmdOrCtrl+F', 'CmdOrCtrl+,', 'CmdOrCtrl+Enter']) {
      expect(accelerators, key).toContain(key.toLowerCase())
    }
  })
})

test.describe('ドロワーのリサイズ', () => {
  test('LAY-04 左ドロワー：境界のドラッグで幅が変わり、最小幅・最大幅を超えない', async ({ launch }) => {
    const app = await launch()
    await drag(app, 'left', 80, 0)
    expect(await width(app, 'left')).toBe(340)
    await drag(app, 'left', 400, 0)
    expect(await width(app, 'left')).toBe(DRAWER_LIMITS.left.max)
    await drag(app, 'left', -500, 0)
    expect(await width(app, 'left')).toBe(DRAWER_LIMITS.left.min)
  })

  test('LAY-05 右ドロワー：境界のドラッグで幅が変わり、最小幅・最大幅を超えない', async ({ launch }) => {
    const app = await launch()
    await drag(app, 'right', -80, 0)
    expect(await width(app, 'right')).toBe(400)
    await drag(app, 'right', -400, 0)
    expect(await width(app, 'right')).toBe(DRAWER_LIMITS.right.max)
    await drag(app, 'right', 500, 0)
    expect(await width(app, 'right')).toBe(DRAWER_LIMITS.right.min)
  })

  test('LAY-06 下ドロワー：境界のドラッグで高さが変わり、最小・最大を超えない', async ({ launch }) => {
    const app = await launch({ settings: { layout: { bottom: { open: true } } } })
    expect(await height(app)).toBe(280)
    await drag(app, 'bottom', 0, -60)
    expect(await height(app)).toBe(340)
    await drag(app, 'bottom', 0, 240)
    expect(await height(app)).toBe(DRAWER_LIMITS.bottom.min)
    await drag(app, 'bottom', 0, -500)
    const viewportHeight = await app.page.evaluate(() => window.innerHeight)
    const h = await height(app)
    expect(h).toBeGreaterThan(DRAWER_LIMITS.bottom.min)
    expect(h).toBeLessThanOrEqual(DRAWER_LIMITS.bottom.max)
    expect(h).toBeLessThan(viewportHeight) // 上段（本文ビュー）が残る
  })

  test('LAY-07 左右のドロワーを最大まで広げても、本文ビューが狭くなりすぎない', async ({ launch }) => {
    // 仕様との差分（既知）: 左 520 + 右 640 が既定のウィンドウ幅 1280 をほぼ使い切り、本文ビューが 120px しか残らない。
    // 直ったら「失敗するはずが成功した」と報告されるので、この行を外す。
    test.fail()
    // ドラッグで到達できる最大幅（左 520・右 640）にした状態から始める
    const app = await launch({ settings: { layout: { left: { width: DRAWER_LIMITS.left.max }, right: { width: DRAWER_LIMITS.right.max } } } })
    await app.open('Short.md')
    const center = (await app.page.locator('.center').boundingBox())!
    // 「狭くなりすぎない」の目安として、本文が 1 行に 20 文字程度は入る幅（240px）を下限とみなす
    expect(center.width).toBeGreaterThanOrEqual(240)
    await expect(app.body.locator('p').first()).toBeInViewport()
  })
})

test.describe('レイアウトの記憶', () => {
  test('LAY-08 各ドロワーの開閉状態と幅を保存し、次回起動時に復元する', async ({ launch }) => {
    const app = await launch()
    await app.left.locator('.drawer-toggle').click() // 左を閉じる
    await drag(app, 'right', -80, 0) // 右を 400 に
    await app.menu('CmdOrCtrl+D') // 下を開く
    await expect(app.bottom).toHaveClass(/open/)
    await drag(app, 'bottom', 0, -60) // 下を 340 に

    await expect
      .poll(() => app.settingsOnDisk()?.layout)
      .toEqual({ left: { open: false, width: 260 }, right: { open: true, width: 400 }, bottom: { open: true, height: 340 } })

    await app.restart()
    await expect(app.left).toHaveClass(/closed/)
    await expect(app.right).toHaveClass(/open/)
    await expect(app.bottom).toHaveClass(/open/)
    expect(await width(app, 'right')).toBe(400)
    expect(await height(app)).toBe(340)
    // 閉じていた左ドロワーも、開けば前の幅に戻る
    await app.left.locator('.drawer-toggle').click()
    expect(await width(app, 'left')).toBe(260)
  })

  test('LAY-09 ウィンドウの位置とサイズを記憶し、次回起動時に復元する', async ({ launch }) => {
    const app = await launch()
    const target = { x: 80, y: 90, width: 900, height: 640 }
    await app.setWindowBounds(target)
    await expect.poll(() => app.stateOnDisk()?.window).toEqual(target)

    await app.restart()
    expect(await app.windowBounds()).toEqual(target)
  })
})
