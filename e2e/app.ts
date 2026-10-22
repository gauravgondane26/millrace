import { expect, test, type Page } from '@playwright/test'

/** Helpers shared by the specs: what a user sees and does in the app. */
export const USERS = '{"users": [{"name": "ada", "age": 36}, {"name": "grace", "age": 45}]}'
export const SCREENS = 'test-results/screens'

/**
 * Open the app before each test, and fail any test during which the page threw
 * an uncaught error. Call once at the top of a spec file.
 */
export function openApp() {
  const pageErrors = new WeakMap<Page, Error[]>()
  test.beforeEach(async ({ page }) => {
    const errors: Error[] = []
    pageErrors.set(page, errors)
    page.on('pageerror', (e) => errors.push(e))
    await page.goto('/')
    // the parser has loaded once the canvas shows the source node
    await expect(node(page, 'source: input')).toBeVisible()
  })
  test.afterEach(async ({ page }) => {
    expect(pageErrors.get(page), 'uncaught errors on the page').toEqual([])
  })
}

/** Paste `input` and type `filter` into the editor, replacing what was there. */
export async function preview(page: Page, input: string, filter: string) {
  await page.getByRole('textbox', { name: 'Input JSON' }).fill(input)
  await page.getByRole('textbox', { name: 'jq filter source' }).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(filter)
}

export const outputPane = (page: Page) => page.getByRole('region', { name: 'Output' })
export const output = (page: Page) => outputPane(page).locator('pre')
/** The editor's text, one entry per line. */
export const editorLines = (page: Page) => page.locator('.cm-content .cm-line')

/** A canvas node, by its accessible name: "kind: text". */
export const node = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Pipeline' }).getByRole('group', { name, exact: true })
