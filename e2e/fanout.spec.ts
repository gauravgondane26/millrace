import { expect, test, type Page } from '@playwright/test'
import { addStage, editorLines, node, openApp, output, preview, SCREENS, USERS } from './app.ts'

/**
 * Fan-out (Phase 7): an object or array construction draws each value's pipe
 * chain as a lane with its own previews, run on the construction's input
 * (invariant 3), and lane stages edit like any other: as splices of their own
 * text (invariant 2), undone through the editor (invariant 7).
 */
openApp()

const SUMMARY = '{n: .users | length, names: [.users[] | .name]}'

const action = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

test('draws a lane per value, each stage with its own preview', async ({ page }) => {
  await preview(page, USERS, SUMMARY)
  await expect(output(page)).toHaveText('{ "n": 2, "names": [ "ada", "grace" ] }')

  // lane n: .users | length
  await expect(node(page, 'pick: .users, for key n')).toContainText('1 value · [{"name":"ada","age":36}')
  await expect(node(page, 'custom: length')).toContainText('1 value · 2')
  // lane names: an array whose contents are a lane of their own
  await expect(node(page, 'array: [.users[] | .name], for key names')).toContainText('1 value · ["ada","grace"]')
  await expect(node(page, 'custom: .users[]')).toContainText('2 values · {"name":"ada","age":36}')
  await expect(node(page, 'pick: .name')).toContainText('2 values · "ada"')
  await expect(node(page, `object: ${SUMMARY}`)).toContainText('1 value · {"n":2,"names":["ada","grace"]}')
  await page.screenshot({ path: `${SCREENS}/fanout.png` })
})

test("shows a lane stage's preview when it is selected", async ({ page }) => {
  await preview(page, USERS, SUMMARY)
  await node(page, 'pick: .name').click()
  await expect(output(page)).toHaveText('"ada" "grace"')
  await page.screenshot({ path: `${SCREENS}/fanout-selected.png` })
})

test('draws a shorthand entry as part of its construction only', async ({ page }) => {
  await preview(page, USERS, '.users[0] | {name, age: .age}')
  await expect(node(page, 'pick: .age, for key age')).toContainText('1 value · 36')
  await expect(node(page, 'object: {name, age: .age}')).toContainText('{"name":"ada","age":36}')
})

test('keeps a value the grammar cannot read as one custom stage, still previewed', async ({ page }) => {
  // valid jq 1.8, which tree-sitter-jq rejects inside an object
  await preview(page, USERS, '.users[0] | {next: .age + 1, name: .name}')
  await expect(node(page, 'custom: .age + 1, for key next')).toContainText('1 value · 37')
  await expect(node(page, 'pick: .name, for key name')).toContainText('"ada"')
  await expect(output(page)).toHaveText('{ "next": 37, "name": "ada" }')
})

test('an error in a lane stays on its stage, and blocks the construction', async ({ page }) => {
  await preview(page, USERS, '.users | {a: first | error("boom"), b: length}')
  await expect(node(page, 'custom: first, for key a')).toContainText('1 value · {"name":"ada","age":36}')
  await expect(node(page, 'custom: error("boom")')).toContainText('boom')
  await expect(node(page, 'custom: length, for key b')).toContainText('1 value · 2')
  await expect(node(page, 'object: {a: first | error("boom"), b: length}')).toContainText('blocked by an earlier error')
  await expect(output(page)).toHaveText('Blocked by an error in custom error("boom"): boom')
})

test('edits a lane stage in place, parenthesizing what an object value needs', async ({ page }) => {
  await preview(page, USERS, '.users[0] | {\n  name: .name,\n  age: .age\n}')
  await node(page, 'pick: .age, for key age').dblclick()
  const field = page.getByRole('textbox', { name: 'Edit .age' })
  await field.fill('.age * 2')
  await field.press('Enter')

  // only that value changed, and its layout around it stayed
  await expect(editorLines(page)).toHaveText(['.users[0] | {', '  name: .name,', '  age: (.age * 2)', '}'])
  // the edited stage stays selected
  await expect(output(page)).toHaveText('72')
  await node(page, 'object: {\n  name: .name,\n  age: (.age * 2)\n}').click()
  await expect(output(page)).toHaveText('{ "name": "ada", "age": 72 }')
})

test('adds a stage inside a lane, and selects it', async ({ page }) => {
  await preview(page, USERS, SUMMARY)
  await node(page, 'pick: .name').click()
  await addStage(page, '.name', 'custom', { jq: 'ascii_upcase' })

  await expect(editorLines(page)).toHaveText(['{n: .users | length, names: [.users[] | .name | ascii_upcase]}'])
  await expect(node(page, 'custom: ascii_upcase')).toBeFocused()
  await expect(output(page)).toHaveText('"ADA" "GRACE"')
})

test('deletes a lane stage, and undo puts it back', async ({ page }) => {
  await preview(page, USERS, SUMMARY)
  await node(page, 'custom: length').click()
  await action(page, 'Delete length').click()

  await expect(editorLines(page)).toHaveText(['{n: .users, names: [.users[] | .name]}'])
  // focus moves to the stage before it in its lane
  await expect(node(page, 'pick: .users, for key n')).toBeFocused()

  await page.keyboard.press('ControlOrMeta+z')
  await expect(editorLines(page)).toHaveText([SUMMARY])
})

test("edits a lane stage's fields in the Stage pane", async ({ page }) => {
  await preview(page, USERS, '{old: [.users[] | select(.age > 40) | .name]}')
  await node(page, 'select: select(.age > 40)').click()
  const field = page.getByRole('region', { name: 'Stage' }).getByLabel('Keep items where')
  await field.fill('.age < 40')
  await field.press('Enter')

  await expect(editorLines(page)).toHaveText(['{old: [.users[] | select(.age < 40) | .name]}'])
  await node(page, 'object: {old: [.users[] | select(.age < 40) | .name]}').click()
  await expect(output(page)).toHaveText('{ "old": [ "ada" ] }')
})
