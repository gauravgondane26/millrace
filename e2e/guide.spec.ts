import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { lowContrast } from './contrast.ts'
import { editorLines, node, openApp, outputPane, preview, SCREENS, USERS } from './app.ts'

/**
 * The guide: a drawer that opens from the header or the empty Output pane,
 * lies over the panes without moving them, and loads each section's example
 * in place of the document as one undoable step, with Undo in the notice.
 */
openApp()

const guideButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Guide', exact: true })
const guide = (page: Page) => page.getByRole('dialog', { name: 'Guide' })
const tryIt = (page: Page, title: string) => guide(page).getByRole('button', { name: `Try it: ${title}`, exact: true })
const inputBox = (page: Page) => page.getByRole('textbox', { name: 'Input JSON' })
const undo = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Undo', exact: true })
const notice = (page: Page) => page.getByRole('banner').getByRole('status')

const box = async (locator: Locator) => {
  const b = await locator.boundingBox()
  if (!b) throw new Error('not visible')
  return b
}
const PANES = ['Input JSON', 'jq filter', 'Pipeline', 'Stage', 'Output']
const panes = async (page: Page) =>
  Promise.all(PANES.map((name) => box(page.getByRole('region', { name, exact: true }))))

test('opens from the header, and from the empty Output pane', async ({ page }) => {
  await guideButton(page).click()
  await expect(guide(page)).toBeVisible()
  await expect(guide(page).getByRole('heading', { name: 'Objects fan out', level: 3 })).toBeVisible()
  await guideButton(page).click()
  await expect(guide(page)).toHaveCount(0)

  await outputPane(page).getByRole('button', { name: 'Open the guide' }).click()
  await expect(guide(page)).toBeVisible()
  await page.screenshot({ path: `${SCREENS}/guide.png` })
})

test('Try it loads the example, previews it, and leaves the guide open', async ({ page }) => {
  await guideButton(page).click()
  await tryIt(page, 'Objects fan out').click()

  await expect(editorLines(page)).toHaveText(['.users | {count: length, names: map(.name)}'])
  await expect(inputBox(page)).toHaveValue(/"barbara"/)
  await expect(node(page, 'map: map(.name), for key names')).toContainText('1 value · ["ada","grace","linus","barbara"]')
  await expect(notice(page)).toHaveText('Loaded the example: Objects fan out.')
  await expect(guide(page)).toBeVisible()
  await expect(tryIt(page, 'Objects fan out')).toBeFocused()

  // the broken example: its error on its card, the stage after it blocked
  await tryIt(page, 'When something breaks').click()
  await expect(node(page, 'custom: lenght')).toContainText('lenght/0 is not defined')
  await expect(node(page, 'custom: reduce .[] as $u (0; . + $u.age)')).toContainText('1 value · 161')
  await expect(node(page, 'custom: tostring')).toContainText('blocked')
  await page.screenshot({ path: `${SCREENS}/guide-try-it.png` })
})

test('Undo in the notice brings back the document, input too', async ({ page }) => {
  await preview(page, USERS, '.users | length')
  await expect(node(page, 'custom: length')).toContainText('1 value · 2')
  await guideButton(page).click()
  await tryIt(page, 'Every stage, previewed').click()
  await expect(editorLines(page)).toHaveText(['.users | map(select(.age > 30)) | map(.name)'])

  await undo(page).click()
  await expect(editorLines(page)).toHaveText(['.users | length'])
  await expect(inputBox(page)).toHaveValue(USERS)
  await expect(notice(page)).toHaveText('Back to your document.')
  await expect(undo(page)).toHaveCount(0)
})

test('Ctrl+Z in the editor steps the jq back', async ({ page }) => {
  await preview(page, USERS, '.users | length')
  await expect(node(page, 'custom: length')).toContainText('1 value · 2')
  await guideButton(page).click()
  await tryIt(page, 'Edit on the canvas').click()
  await expect(editorLines(page)).toHaveText(['.users | sort_by(.age) | map(.name)'])

  await page.getByRole('textbox', { name: 'jq filter source' }).focus()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editorLines(page)).toHaveText(['.users | length'])
})

test('Escape closes it, and focus returns to the Guide button', async ({ page }) => {
  await guideButton(page).click()
  await expect(guide(page)).toBeVisible()
  await tryIt(page, 'Bring your data').focus()
  await page.keyboard.press('Escape')
  await expect(guide(page)).toHaveCount(0)
  await expect(guideButton(page)).toBeFocused()
})

test('Escape meant for the editor leaves it open', async ({ page }) => {
  await guideButton(page).click()
  await page.getByRole('textbox', { name: 'jq filter source' }).focus()
  await page.keyboard.press('Escape')
  await expect(guide(page)).toBeVisible()
})

test('opening it moves no pane', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name)')
  await expect(node(page, 'map: map(.name)')).toContainText('1 value')
  const before = await panes(page)
  await guideButton(page).click()
  await expect(guide(page)).toBeVisible()
  expect(await panes(page)).toEqual(before)
})

test('passes axe and AA contrast while open', async ({ page }) => {
  await guideButton(page).click()
  await tryIt(page, 'Objects fan out').click()
  await expect(node(page, 'map: map(.name), for key names')).toContainText('1 value')
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  expect(await lowContrast(page)).toEqual([])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('it is a full-width sheet', async ({ page }) => {
    await guideButton(page).click()
    const sheet = await box(guide(page))
    expect(sheet.x).toBe(0)
    expect(sheet.width).toBe(390)
    await expect(tryIt(page, 'Bring your data')).toBeInViewport()
    await page.screenshot({ path: `${SCREENS}/guide-phone.png` })
  })
})
