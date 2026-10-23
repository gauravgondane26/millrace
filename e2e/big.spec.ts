import { expect, test, type Page } from '@playwright/test'
import { node, openApp, output, outputPane, preview } from './app.ts'

/**
 * Big inputs and outputs (quality bar: a 50 MB input without freezing).
 * Input past 1 MB is shown rather than put in a textarea, whose own editing
 * froze the page for seconds; output is drawn a window of lines at a time.
 */
openApp()
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

/** `{"users": [...]}` of about `mb` megabytes, built in the page. */
async function makeInput(page: Page, mb: number) {
  await page.evaluate((mb) => {
    const user = (i: number) => `{"id":${i},"name":"user ${i}","age":${20 + (i % 50)},"tags":["a","b"]}`
    const parts: string[] = []
    let size = 0
    for (let i = 0; size < mb * 1_000_000; i++) {
      const u = user(i)
      parts.push(u)
      size += u.length + 1
    }
    const w = window as unknown as { big: string }
    w.big = `{"users":[${parts.join(',')}]}`
  }, mb)
}

/** Paste the text made by makeInput (a paste event, as Ctrl+V sends). */
async function pasteBig(page: Page, target: string) {
  await page.evaluate((selector) => {
    const data = new DataTransfer()
    data.setData('text/plain', (window as unknown as { big: string }).big)
    const el = document.querySelector(selector)
    if (!el) throw new Error(`no ${selector}`)
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    if (!event.defaultPrevented) throw new Error('the paste went to the textarea')
  }, target)
}

const largeNote = (page: Page) => page.locator('#large-input-note')

test('a paste past 1 MB is shown, not edited, and previews as usual', async ({ page }) => {
  await preview(page, '', '.users | length')
  await makeInput(page, 3)
  await pasteBig(page, 'textarea[aria-label="Input JSON"]')
  await expect(largeNote(page)).toContainText(/^3\.0 MB: too big to edit here/)
  await expect(page.getByRole('textbox', { name: 'Input JSON' })).toHaveCount(0)
  // the preview runs on the sample: arrays cut to 200 items
  await expect(node(page, 'custom: length')).toContainText('1 value · 200')

  // a small paste over the large view puts the text field back
  const view = page.getByRole('region', { name: 'Input JSON' }).last()
  await view.focus()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', '{"users": [1, 2, 3]}')
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('textbox', { name: 'Input JSON' })).toHaveValue('{"users": [1, 2, 3]}')
  await expect(node(page, 'custom: length')).toContainText('1 value · 3')
})

test('opens a file, or takes one dropped on the pane', async ({ page }) => {
  await preview(page, '', '.users | length')
  const json = JSON.stringify({ users: Array.from({ length: 50_000 }, (_, i) => ({ id: i, name: `user ${i}` })) })
  await page.locator('input[type=file]').setInputFiles({ name: 'users.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await expect(largeNote(page)).toContainText(/^1\.\d MB/)
  await expect(node(page, 'custom: length')).toContainText('1 value · 200')

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Input JSON' })).toHaveValue('')

  const drop = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['{"users": ["a", "b"]}'], 'small.json', { type: 'application/json' }))
    return data
  })
  await page.getByRole('textbox', { name: 'Input JSON' }).dispatchEvent('drop', { dataTransfer: drop })
  await expect(page.getByRole('textbox', { name: 'Input JSON' })).toHaveValue('{"users": ["a", "b"]}')
  await expect(node(page, 'custom: length')).toContainText('1 value · 2')
})

test('a 50 MB paste never blocks the page for long', async ({ page }) => {
  test.setTimeout(90_000)
  await preview(page, '', '.users | map(.age) | unique | length')
  await makeInput(page, 50)
  await page.evaluate(() => {
    const w = window as unknown as { tasks: number[] }
    w.tasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.tasks.push(entry.duration)
    }).observe({ type: 'longtask' })
  })
  await pasteBig(page, 'textarea[aria-label="Input JSON"]')
  await expect(largeNote(page)).toContainText(/^5\d\.\d MB/)
  await expect(node(page, 'custom: length')).toContainText('1 value · 50', { timeout: 30_000 })
  // typing in the editor stays immediate with the big input loaded
  await page.getByRole('textbox', { name: 'jq filter source' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' + 1')
  await expect(node(page, 'custom: length + 1')).toContainText('1 value · 51')
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { tasks: number[] }).tasks))
  // a frame is 16 ms; the textarea used to take 6 s or more
  expect(longest).toBeLessThan(250)
})

test('a long output draws only what is on screen, and copies whole', async ({ page }) => {
  await preview(page, 'null', '[range(100000)]')
  await expect(outputPane(page)).toContainText('1 value')
  await expect(output(page)).toContainText('[ 0, 1, 2,') // the first lines
  const drawn = await output(page).evaluate((pre) => pre.textContent?.split('\n').length ?? 0)
  expect(drawn).toBeLessThan(500)

  // scrolled to the end, the last value is there
  const scroller = output(page).locator('xpath=../..')
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(output(page)).toContainText('99999')

  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.split('\n')).toHaveLength(100_002) // "[", 100,000 values, "]"
})
