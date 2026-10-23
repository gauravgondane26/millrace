import { expect, test, type Page } from '@playwright/test'
import { editorLines, node, openApp, output, preview, SCREENS, USERS } from './app.ts'

/**
 * Persistence (Phase 8): the working document is kept in IndexedDB, and a
 * share link carries it in the URL fragment. Each test gets a fresh browser
 * context, so fresh storage.
 */
openApp()
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const NAMES = '[ "ada", "grace" ]'
const input = (page: Page) => page.getByRole('textbox', { name: 'Input JSON' })
const notice = (page: Page) => page.getByRole('banner').getByRole('status')

/** What IndexedDB holds for the document. */
const saved = (page: Page, field: 'source' | 'input') =>
  page.evaluate(
    (key) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('millrace', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction('document').objectStore('document').get(key)
          get.onsuccess = () => resolve(get.result)
          get.onerror = () => reject(get.error)
        }
      }),
    field,
  )

/** Click Share and return the link it copied. */
async function share(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(notice(page)).toContainText('Link copied')
  return page.evaluate(() => navigator.clipboard.readText())
}

test('a reload brings back the jq and the input', async ({ page }) => {
  await preview(page, USERS, '.users\n| map(.name) # names')
  await expect(output(page)).toHaveText(NAMES)
  await expect.poll(() => saved(page, 'source')).toBe('.users\n| map(.name) # names')
  await expect.poll(() => saved(page, 'input')).toBe(USERS)

  await page.reload()
  await expect(editorLines(page)).toHaveText(['.users', '| map(.name) # names'])
  await expect(input(page)).toHaveValue(USERS)
  await expect(output(page)).toHaveText(NAMES)

  // restoring is not an edit: there is nothing to undo
  await page.getByRole('textbox', { name: 'jq filter source' }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editorLines(page)).toHaveText(['.users', '| map(.name) # names'])
})

test('a share link opens the same jq and input elsewhere', async ({ page, browser }) => {
  await preview(page, USERS, '.users | map(.name)')
  const link = await share(page)
  expect(new URL(link).hash).toMatch(/^#v1=/)

  // a different browser profile: nothing saved there
  const elsewhere = await browser.newContext()
  const other = await elsewhere.newPage()
  await other.goto(link)
  await expect(editorLines(other)).toHaveText(['.users | map(.name)'])
  await expect(input(other)).toHaveValue(USERS)
  await expect(output(other)).toHaveText(NAMES)
  await expect(notice(other)).toHaveText('Opened the shared link.')
  // the fragment is gone, so a reload keeps later edits rather than reopening the link
  expect(new URL(other.url()).hash).toBe('')
  await other.screenshot({ path: `${SCREENS}/shared.png` })
  await elsewhere.close()
})

test('leaves out input too big for a link, and says so', async ({ page, browser }) => {
  const big = JSON.stringify(Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `user ${i}` })))
  await preview(page, big, 'length')
  await expect(output(page)).toHaveText('200')
  const link = await share(page)
  await expect(notice(page)).toContainText('Link copied with the jq only')

  const elsewhere = await browser.newContext()
  const other = await elsewhere.newPage()
  await other.goto(link)
  await expect(editorLines(other)).toHaveText(['length'])
  await expect(input(other)).toHaveValue('')
  await expect(notice(other)).toContainText('Opened the shared link: its jq, with your own input.')
  await elsewhere.close()
})

test('a link that cannot be read leaves the saved document as it was', async ({ page, context }) => {
  await preview(page, USERS, '.users | length')
  await expect.poll(() => saved(page, 'source')).toBe('.users | length')

  const other = await context.newPage()
  await other.goto('/#v1=cut-short')
  await expect(notice(other)).toContainText('That link could not be read')
  await expect(editorLines(other)).toHaveText(['.users | length'])
  await expect(input(other)).toHaveValue(USERS)
})

test('a share link pasted into an open tab replaces the jq, and Ctrl+Z brings it back', async ({ page }) => {
  await preview(page, USERS, '.users | map(.age)')
  const link = await share(page)

  await page.getByRole('textbox', { name: 'jq filter source' }).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('.users | length')
  await expect(output(page)).toHaveText('2')

  // only the hash changes, so the page doesn't reload
  await page.evaluate((hash) => (location.hash = hash), new URL(link).hash)
  await expect(editorLines(page)).toHaveText(['.users | map(.age)'])
  await expect(node(page, 'map: map(.age)')).toBeVisible()
  await expect(notice(page)).toHaveText('Opened the shared link in place of your document.')
  expect(new URL(page.url()).hash).toBe('')

  await page.getByRole('textbox', { name: 'jq filter source' }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editorLines(page)).toHaveText(['.users | length'])
})

test('shows the link to copy by hand when the clipboard is off limits', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'))
  })
  await page.reload()
  await preview(page, USERS, '.users')
  await page.getByRole('button', { name: 'Share', exact: true }).click()

  const field = page.getByRole('textbox', { name: 'Share link' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue(/#v1=/)
  await expect(notice(page)).toContainText('Copy this link:')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(field).toBeHidden()
})

test('says so when the browser will not keep the document', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined })
  })
  await page.reload()
  await expect(notice(page)).toContainText('not letting millrace save')
  // the app still works, it just can't keep anything
  await preview(page, USERS, '.users | length')
  await expect(output(page)).toHaveText('2')
})

test.describe('leaving right after typing', () => {
  /** Pretend the tab was hidden (switched away from, or closing). */
  const hide = (page: Page) =>
    page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })

  test('keeps the last keystrokes, still inside the debounces', async ({ page }) => {
    await preview(page, USERS, '.users')
    await expect.poll(() => saved(page, 'source')).toBe('.users')
    // timers stop: neither the 200 ms reparse nor the 300 ms save can fire,
    // so only leaving can save what comes next
    await page.clock.install()
    await page.clock.pauseAt(new Date('2030-01-01T00:00:00Z'))
    await page.keyboard.type(' | length')
    await hide(page)
    await expect.poll(() => saved(page, 'source')).toBe('.users | length')
  })

  test('closing the tab right after typing keeps them too', async ({ page, context }) => {
    await preview(page, USERS, '.users')
    await expect.poll(() => saved(page, 'source')).toBe('.users')
    await page.keyboard.type(' | length')
    await page.close({ runBeforeUnload: true })

    const again = await context.newPage()
    await again.goto('/')
    await expect(editorLines(again)).toHaveText(['.users | length'])
  })
})

test.describe('undoing a shared link', () => {
  const undo = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Undo', exact: true })
  const OTHER = '{"users": [{"name": "linus", "age": 54}]}'

  test('opened at startup over a saved document: Undo brings it back, input too', async ({ page, browser, context }) => {
    // a link made elsewhere, with its own jq and input
    const elsewhere = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const sender = await elsewhere.newPage()
    await sender.goto('/')
    await preview(sender, OTHER, '.users | length')
    await expect(output(sender)).toHaveText('1')
    const link = await share(sender)
    await elsewhere.close()

    await preview(page, USERS, '.users | map(.name)')
    await expect.poll(() => saved(page, 'source')).toBe('.users | map(.name)')
    const opened = await context.newPage()
    await opened.goto(link)
    await expect(editorLines(opened)).toHaveText(['.users | length'])
    await expect(input(opened)).toHaveValue(OTHER)
    await expect(notice(opened)).toHaveText('Opened the shared link in place of your document.')

    await undo(opened).click()
    await expect(editorLines(opened)).toHaveText(['.users | map(.name)'])
    await expect(input(opened)).toHaveValue(USERS)
    await expect(output(opened)).toHaveText(NAMES)
    await expect(notice(opened)).toHaveText('Back to your document.')
    await expect(undo(opened)).toHaveCount(0)
    // and it is the saved document again
    await expect.poll(() => saved(opened, 'input')).toBe(USERS)
    await expect.poll(() => saved(opened, 'source')).toBe('.users | map(.name)')
  })

  test('pasted into an open tab: Undo puts back the jq and the input', async ({ page }) => {
    await preview(page, OTHER, '.users | length')
    const link = await share(page)
    await preview(page, USERS, '.users | map(.name)')
    await expect(output(page)).toHaveText(NAMES)

    await page.evaluate((hash) => (location.hash = hash), new URL(link).hash)
    await expect(input(page)).toHaveValue(OTHER)
    await undo(page).click()
    await expect(editorLines(page)).toHaveText(['.users | map(.name)'])
    await expect(input(page)).toHaveValue(USERS)
    // the jq came back as one editor step: Ctrl+Z returns to the link's
    await page.getByRole('textbox', { name: 'jq filter source' }).click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editorLines(page)).toHaveText(['.users | length'])
  })

  test('nothing to lose, so no Undo: a first visit', async ({ browser, page }) => {
    await preview(page, OTHER, '.users | length')
    const link = await share(page)
    const fresh = await browser.newContext()
    const visitor = await fresh.newPage()
    await visitor.goto(link)
    await expect(notice(visitor)).toHaveText('Opened the shared link.')
    await expect(undo(visitor)).toHaveCount(0)
    await fresh.close()
  })
})

test('two tabs: the one changed last saves, and the other says so', async ({ page, context }) => {
  const elsewhere = (p: Page) => p.getByRole('banner').getByText('Open in another tab: changes here aren’t saved.')
  const saveHere = (p: Page) => p.getByRole('banner').getByRole('button', { name: 'Save here instead', exact: true })
  const typeAtEnd = async (p: Page, text: string) => {
    await p.getByRole('textbox', { name: 'jq filter source' }).click()
    await p.keyboard.press('ControlOrMeta+End')
    await p.keyboard.type(text)
  }

  await preview(page, USERS, '.users')
  await expect.poll(() => saved(page, 'source')).toBe('.users')

  // opening a second tab changes nothing, so it claims nothing
  const second = await context.newPage()
  await second.goto('/')
  await expect(editorLines(second)).toHaveText(['.users'])
  await expect(elsewhere(page)).toHaveCount(0)
  await expect(elsewhere(second)).toHaveCount(0)

  // changing it in the second tab makes that one the tab that saves
  await typeAtEnd(second, ' | length')
  await expect.poll(() => saved(second, 'source')).toBe('.users | length')
  await expect(elsewhere(page)).toBeVisible()
  await expect(elsewhere(second)).toHaveCount(0)

  // the first tab's changes no longer land over it
  await typeAtEnd(page, ' | map(.name)')
  await expect(editorLines(page)).toHaveText(['.users | map(.name)'])
  await page.waitForTimeout(800) // past the save delay
  expect(await saved(page, 'source')).toBe('.users | length')

  // until it takes saving back
  await saveHere(page).click()
  await expect.poll(() => saved(page, 'source')).toBe('.users | map(.name)')
  await expect(elsewhere(page)).toHaveCount(0)
  await expect(elsewhere(second)).toBeVisible()

  // a saving tab that closes lets the others save again
  await page.close()
  await expect(elsewhere(second)).toHaveCount(0)
})
