import { expect, test, type Page } from '@playwright/test'
import { node, openApp, output, outputPane, preview, SCREENS, USERS } from './app.ts'

/**
 * The live preview, end to end in a real browser: paste input, type a filter
 * into CodeMirror, read the canvas and the Output pane. Expected values are
 * what jq 1.8.2 prints (pretty, so compared with whitespace collapsed).
 */
openApp()

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
})

test.describe('the canvas', () => {
  test('draws one node per stage, each with its own preview', async ({ page }) => {
    await expectOutput(page, USERS, '.users | sort_by(.age) | map(.name) | unique', '[ "ada", "grace" ]')
    for (const name of ['source: input', 'pick: .users', 'sort_by: sort_by(.age)', 'map: map(.name)', 'unique: unique']) {
      await expect(node(page, name)).toBeVisible()
    }
    await expect(node(page, 'map: map(.name)')).toContainText('1 value · ["ada","grace"]')
    await page.screenshot({ path: `${SCREENS}/canvas.png` })
  })

  test('shows the preview of a clicked node, or one chosen with the keyboard', async ({ page }) => {
    await expectOutput(page, USERS, '.users | map(.name)', '[ "ada", "grace" ]')

    await node(page, 'pick: .users').click()
    await expect(outputPane(page)).toContainText('.users · 1 value')
    await expect(output(page)).toHaveText('[ { "name": "ada", "age": 36 }, { "name": "grace", "age": 45 } ]')

    await node(page, 'map: map(.name)').focus()
    await page.keyboard.press('Enter')
    await expect(output(page)).toHaveText('[ "ada", "grace" ]')
  })

  test('marks a failing stage, and blocks the ones after it', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name + 1) | length')
    await expect(node(page, 'map: map(.name + 1)')).toContainText('string ("ada") and number (1) cannot be added')
    await expect(node(page, 'custom: length')).toContainText('blocked by an earlier error')
    await expect(output(page)).toHaveText(
      'Blocked by an error in map map(.name + 1): string ("ada") and number (1) cannot be added',
    )
    await expect(node(page, 'pick: .users')).toContainText('1 value')
  })
})

test.describe('sampling (invariant 4)', () => {
  test('previews a sample, and Run full runs the whole program on the whole input', async ({ page }) => {
    const big = JSON.stringify(Array.from({ length: 300 }, (_, i) => i))
    await expectOutput(page, big, 'length', '200')
    await expect(outputPane(page).getByRole('status')).toHaveText(
      'Previewing a sample: arrays cut to 200 items. Run full for the complete result.',
    )
    await page.screenshot({ path: `${SCREENS}/sampled.png` })

    await page.getByRole('button', { name: 'Run full' }).click()
    await expect(output(page)).toHaveText('300')
    await expect(outputPane(page)).toContainText('Whole program on the whole input')
    await expect(outputPane(page).getByRole('status')).toHaveText('')

    // an edit goes back to the sample
    await page.getByRole('textbox', { name: 'jq filter source' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' + 1')
    await expect(output(page)).toHaveText('201')
  })
})

test.describe('errors, in jq’s words', () => {
  test('compile error, on the stage it belongs to, with its caret', async ({ page }) => {
    await expectError(
      page,
      USERS,
      '.users | map(.name',
      // regexes match the raw text: newlines and the caret's indentation included.
      // jq compiled the stage alone; the line and column are the editor's.
      /^syntax error, unexpected end of file, expecting ';' or '\)' at line 1, column 14:\n {4}\.users \| map\(\.name\n {17}\^\^\^\^\^$/,
    )
    const stage = node(page, 'custom: map(.name')
    await expect(stage).toContainText("syntax error, unexpected end of file, expecting ';' or ')'")
    // a screen reader hears it as the node's description
    await expect(stage).toHaveAccessibleDescription(/^syntax error, unexpected end of file/)
    // and the editor marks what jq pointed at
    await expect(page.locator('.cm-lintRange-error')).toHaveText('.name')
    await page.screenshot({ path: `${SCREENS}/compile-error.png` })
  })

  test('compile error in a later line, placed in the program', async ({ page }) => {
    await expectError(
      page,
      USERS,
      '.users[]\n| select(.age ==)',
      /^syntax error, unexpected '\)' at line 2, column 17:\n {4}\| select\(\.age ==\)\n {20}\^$/,
    )
    await expect(page.locator('.cm-lintRange-error')).toHaveText(')')
  })

  test('runtime error, marked on its stage in the editor', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name + 1)')
    await expect(page.locator('.cm-lintRange-error')).toHaveText('map(.name + 1)')
    // fixing it clears the mark
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
    await page.keyboard.type(')')
    await expect(output(page)).toHaveText('[ "ada", "grace" ]')
    await expect(page.locator('.cm-lintRange-error')).toHaveCount(0)
  })

  test('runtime error', async ({ page }) => {
    await expectError(page, '1', '.foo', 'Cannot index number with string ("foo")')
  })

  test('invalid input, on the input node', async ({ page }) => {
    await expectError(page, '{"a":', '.', 'input is not valid JSON: Unfinished JSON term at EOF at line 1, column 5')
    await expect(node(page, 'source: input')).toContainText('input is not valid JSON')
    // bad input isn't the program's fault: nothing is marked in the editor
    await expect(page.locator('.cm-lintRange-error')).toHaveCount(0)
  })

  test('halt_error message', async ({ page }) => {
    await expectError(page, USERS, '"boom" | halt_error', 'boom')
  })
})

test.describe('runaway filters', () => {
  test('cuts long output at 1 MB, and says so', async ({ page }) => {
    await preview(page, USERS, 'limit(600000; repeat(1))')
    await expect(outputPane(page).getByRole('status')).toHaveText('Output cut at 1 MB; the filter produces more.')
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
