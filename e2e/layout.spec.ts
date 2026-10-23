import { expect, test, type Locator, type Page } from '@playwright/test'
import { node, openApp, output, outputPane, preview, SCREENS, stagePane, USERS } from './app.ts'

/**
 * No layout shift (quality bar): selecting a node, opening the add form, or a
 * preview arriving with or without a notice never moves the panes, the
 * output, the cards or the edges between them.
 */
openApp()

const box = async (locator: Locator) => {
  const b = await locator.boundingBox()
  if (!b) throw new Error('not visible')
  return b
}

const panes = async (page: Page) => ({ stage: await box(stagePane(page)), output: await box(outputPane(page)) })

test('the Stage pane is one height for every kind, and the add form', async ({ page }) => {
  await preview(page, USERS, '.users | select(length > 0) | map(.age) | unique | limit(1; .[]) | tostring')
  await expect(node(page, 'custom: tostring')).toContainText('1 value')
  const before = await panes(page)

  for (const name of [
    'source: input',
    'pick: .users',
    'select: select(length > 0)',
    'map: map(.age)',
    'unique: unique',
    'limit: limit(1; .[])',
    'custom: tostring',
  ]) {
    // by keyboard: the chain is wider than the canvas, which pans to a focused node
    await node(page, name).focus()
    await page.keyboard.press('Enter')
    await expect(node(page, name)).toHaveClass(/selected/)
    expect(await panes(page), name).toEqual(before)
  }
  await page.getByRole('button', { name: 'Add a stage after tostring', exact: true }).click()
  const form = page.getByRole('form', { name: 'Add a stage after tostring' })
  for (const kind of ['select', 'unique', 'limit', 'custom']) {
    await form.getByRole('combobox').selectOption(kind)
    expect(await panes(page), `add ${kind}`).toEqual(before)
    // nothing in the form is cut off or scrolled away
    await expect(form.getByRole('button', { name: 'Add', exact: true })).toBeInViewport({ ratio: 1 })
  }
  await page.screenshot({ path: `${SCREENS}/add-form.png` })
})

test('a notice appearing does not move the output', async ({ page }) => {
  await preview(page, '[1, 2, 3]', 'length')
  await expect(output(page)).toHaveText('3')
  // the output's view (its text is drawn inside, as wide as the text)
  const view = output(page).locator('xpath=../..')
  const before = await box(view)

  // big enough to be sampled, so the notice appears
  await page.getByRole('textbox', { name: 'Input JSON' }).fill(JSON.stringify(Array.from({ length: 500 }, (_, i) => i)))
  await expect(outputPane(page).getByRole('status')).toContainText('Previewing a sample')
  await expect(output(page)).toHaveText('200')
  expect(await box(view)).toEqual(before)
})

test('cards keep their height as previews arrive, and edges stay put on select', async ({ page }) => {
  // no input yet: the cards' status lines are empty
  await preview(page, '', '.users | length')
  const source = node(page, 'source: input')
  await expect(node(page, 'custom: length')).toBeVisible()
  const empty = await box(source)
  await page.getByRole('textbox', { name: 'Input JSON' }).fill(USERS)
  await expect(source).toContainText('1 value')
  expect((await box(source)).height).toBe(empty.height)

  const edges = page.locator('.react-flow__edge-path')
  const paths = await edges.evaluateAll((all) => all.map((e) => e.getAttribute('d')))
  // selecting a card grows its buttons; the edges into and out of it stay
  await node(page, 'pick: .users').click()
  await expect(page.getByRole('button', { name: 'Edit .users', exact: true })).toBeVisible()
  expect(await edges.evaluateAll((all) => all.map((e) => e.getAttribute('d')))).toEqual(paths)
})

test('a chain wider than the canvas keeps the selected result in view', async ({ page }) => {
  await preview(page, USERS, '.users | map(.age) | sort | unique | first | tostring | length')
  const canvas = await box(page.getByRole('region', { name: 'Pipeline' }).locator('.react-flow'))
  const last = node(page, 'custom: length')
  await expect(last).toContainText('1 value')
  // the result, selected by default, is whole on screen, not cut at the edge
  await expect(async () => {
    const card = await box(last)
    expect(card.x).toBeGreaterThanOrEqual(canvas.x)
    expect(card.x + card.width).toBeLessThanOrEqual(canvas.x + canvas.width)
  }).toPass()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('panes stack in one column and keep their height', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name)')
    await expect(node(page, 'map: map(.name)')).toContainText('1 value')
    const names = ['Input JSON', 'jq filter', 'Pipeline', 'Stage', 'Output']
    const boxes = []
    for (const name of names) boxes.push(await box(page.getByRole('region', { name })))
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!
      expect(b.width, names[i]).toBeGreaterThan(380)
      if (i > 0) expect(b.y, names[i]).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1)
    }
    expect(boxes[2]!.height, 'Pipeline').toBeGreaterThanOrEqual(300)
    await page.screenshot({ path: `${SCREENS}/phone.png` })
  })
})
