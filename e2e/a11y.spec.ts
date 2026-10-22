import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { lowContrast } from './contrast.ts'
import { node, openApp, preview, SCREENS, USERS } from './app.ts'

/**
 * Accessibility (quality bar): axe finds nothing at WCAG 2.2 AA, all text
 * meets AA contrast, and every stop on the Tab path shows a focus ring.
 * axe can't judge contrast on the canvas (its cards overlap the pane behind
 * them), so e2e/contrast.ts measures it directly.
 */
openApp()

async function expectAccessible(page: Page, state: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    `axe, ${state}`,
  ).toEqual([])
  expect(await lowContrast(page), `contrast, ${state}`).toEqual([])
}

// a construction (lanes), a stage that fails to compile, and a sampled input
const BIG = JSON.stringify({ users: Array.from({ length: 300 }, (_, i) => ({ name: `user ${i}`, age: 20 + (i % 50) })) })
const PROGRAM = '.users | {n: length, names: map(.name)} | .n | nosuch'

test('passes axe and AA contrast in each state', async ({ page }) => {
  await expectAccessible(page, 'empty')

  await preview(page, BIG, PROGRAM)
  await expect(node(page, 'custom: nosuch')).toContainText('nosuch/0 is not defined')
  await expectAccessible(page, 'a pipeline with lanes and an error')

  await node(page, 'map: map(.name), for key names').focus()
  await page.keyboard.press('Enter')
  await expectAccessible(page, 'a selected node')

  await page.getByRole('button', { name: 'Add a stage after map(.name)', exact: true }).click()
  await expectAccessible(page, 'the add form')
  await page.screenshot({ path: `${SCREENS}/a11y-add-form.png` })

  // a notice in the header
  await page.goto('/#v1=not-a-link')
  await expect(page.getByRole('banner').getByRole('status')).not.toBeEmpty()
  await expectAccessible(page, 'a header notice')
})

test('every Tab stop shows a focus ring', async ({ page }) => {
  await preview(page, USERS, PROGRAM)
  await expect(node(page, 'custom: nosuch')).toContainText('nosuch/0 is not defined')
  await node(page, 'map: map(.name), for key names').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab') // into the selected node's buttons

  const stops: string[] = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName
      const ring = (e: Element | null) => {
        if (!e) return false
        const s = getComputedStyle(e)
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && !/rgba\(.*, 0\)$/.test(s.outlineColor)
      }
      // a canvas node draws its ring on its card; the editor on an overlay
      const editorRing = el.closest('.group')?.querySelector(':scope > [aria-hidden]')
      const shown =
        ring(el) ||
        (el.classList.contains('react-flow__node') && ring(el.firstElementChild)) ||
        (el.classList.contains('cm-content') && !!editorRing && getComputedStyle(editorRing).display !== 'none')
      return { name, shown }
    })
    if (!stop) continue
    if (stops.includes(stop.name)) break // round the page once
    stops.push(stop.name)
    expect(stop.shown, `focus ring on ${stop.name}`).toBe(true)
  }
  // the whole path, canvas and its controls included
  expect(stops).toEqual(
    expect.arrayContaining([
      'Share',
      'Input JSON',
      'jq filter source',
      'source: input',
      'object: {n: length, names: map(.name)}',
      'Zoom in',
      'Fit the pipeline in view',
      'Run full',
    ]),
  )
})
