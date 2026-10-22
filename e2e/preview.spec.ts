import { expect, test, type Page } from '@playwright/test'

/**
 * The live preview, end to end in a real browser: paste input, type a filter
 * into CodeMirror, read what the Output pane shows. Expected values are what
 * jq 1.8.2 prints (pretty, so compared with whitespace collapsed).
 */
const USERS = '{"users": [{"name": "ada", "age": 36}, {"name": "grace", "age": 45}]}'
const SCREENS = 'test-results/screens'

const pageErrors = new WeakMap<Page, Error[]>()

test.beforeEach(async ({ page }) => {
  const errors: Error[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (e) => errors.push(e))
  await page.goto('/')
  // the parser has loaded once the pipeline strip shows the source node
  await expect(page.getByRole('region', { name: 'Pipeline' }).getByRole('listitem').first()).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'uncaught errors on the page').toEqual([])
})

async function preview(page: Page, input: string, filter: string) {
  await page.getByRole('textbox', { name: 'Input JSON' }).fill(input)
  await page.getByRole('textbox', { name: 'jq filter source' }).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(filter)
}

const output = (page: Page) => page.getByRole('region', { name: 'Output' }).locator('pre')

async function expectOutput(page: Page, input: string, filter: string, expected: string) {
  await preview(page, input, filter)
  await expect(output(page)).toHaveText(expected)
  await expect(output(page)).not.toHaveClass(/text-red/)
}

async function expectError(page: Page, input: string, filter: string, expected: string | RegExp) {
  await preview(page, input, filter)
  await expect(output(page)).toHaveText(expected)
  await expect(output(page)).toHaveClass(/text-red/)
}

test.describe('matches jq where jaq did not', () => {
  for (const [filter, input, expected] of [
    ['.a.b = 1', '{}', '{ "a": { "b": 1 } }'],
    ['.[2] = 1', '[]', '[ null, null, 1 ]'],
    ['del(.a)', '{"a":1,"b":2,"c":3}', '{ "b": 2, "c": 3 }'],
    ['10 / 2', USERS, '5'],
    ['join(",")', '["a",null,1]', '"a,,1"'],
    ['2 | IN(1, 2)', USERS, 'true'],
    ['$__loc__', USERS, '{ "file": "<top-level>", "line": 1 }'],
  ] as const) {
    test(filter, async ({ page }) => {
      await expectOutput(page, input, filter, expected)
    })
  }
})

test.describe('keeps working', () => {
  test('keeps key order, including integer-like keys', async ({ page }) => {
    await expectOutput(page, '{"b": 1, "2": 0, "1": 0}', '.', '{ "b": 1, "2": 0, "1": 0 }')
  })

  test('treats each pasted document as an input', async ({ page }) => {
    await expectOutput(page, '1 2 3', '. * 10', '10 20 30')
  })

  test('writes @csv rows', async ({ page }) => {
    await expectOutput(page, USERS, '.users[] | [.name, .age] | @csv', '"\\"ada\\",36" "\\"grace\\",45"')
  })

  test('projects the pipeline alongside the output', async ({ page }) => {
    await expectOutput(page, USERS, '.users | sort_by(.age) | map(.name) | unique', '[ "ada", "grace" ]')
    const kinds = page.getByRole('region', { name: 'Pipeline' }).locator('li > span:first-child')
    await expect(kinds).toHaveText(['source', 'pick', 'sort_by', 'map', 'unique'])
    await page.screenshot({ path: `${SCREENS}/pipeline.png` })
  })
})

test.describe('errors, in jq’s words', () => {
  test('compile error, with its caret', async ({ page }) => {
    await expectError(
      page,
      USERS,
      '.users | map(.name',
      // regexes match the raw text: newlines and the caret's indentation included
      /^syntax error, unexpected end of file, expecting ';' or '\)' at <top-level>, line 1, column 14:\n {4}\.users \| map\(\.name\n {17}\^\^\^\^\^$/,
    )
    await page.screenshot({ path: `${SCREENS}/compile-error.png` })
  })

  test('runtime error', async ({ page }) => {
    await expectError(page, '1', '.foo', 'Cannot index number with string ("foo")')
  })

  test('invalid input', async ({ page }) => {
    await expectError(page, '{"a":', '.', 'input is not valid JSON: Unfinished JSON term at EOF at line 1, column 5')
  })

  test('halt_error message', async ({ page }) => {
    await expectError(page, USERS, '"boom" | halt_error', 'boom')
  })
})

test.describe('runaway filters', () => {
  test('cuts long output at 1 MB, and says so', async ({ page }) => {
    await preview(page, USERS, 'limit(600000; repeat(1))')
    await expect(page.getByRole('status')).toHaveText('Output cut at 1 MB; the filter produces more.')
    await page.screenshot({ path: `${SCREENS}/output-cut.png` })
  })

  for (const filter of ['until(false; .)', 'repeat(1)']) {
    test(`stops ${filter} after 10 s, then recovers`, async ({ page }) => {
      test.setTimeout(45_000)
      await preview(page, USERS, filter)
      await expect(output(page)).toHaveText('Stopped after 10 s: the filter may never finish.', { timeout: 20_000 })
      await page.screenshot({ path: `${SCREENS}/stopped-${filter.replace(/\W+/g, '-')}.png` })
      // a fresh engine takes over
      await preview(page, USERS, '.users | length')
      await expect(output(page)).toHaveText('2')
    })
  }
})
