import { expect, test, type Page } from '@playwright/test'
import { editorLines, node, openApp, output, preview, SCREENS, USERS } from './app.ts'

/**
 * Editing on the canvas (Phase 5): every edit lands in the jq text as a
 * splice of just that node (invariant 2), through the editor so undo covers it
 * (invariants 6 and 7), and the canvas re-derives from the new text.
 */
openApp()

const NAMES = '[ "ada", "grace" ]'

/** Open the selected node's toolbar action, by its accessible name. */
const action = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

test('edits a node in place, splicing only its text', async ({ page }) => {
  await preview(page, USERS, '.users\n| map(.name) # names\n| unique')
  await expect(output(page)).toHaveText(NAMES)

  await node(page, 'map: map(.name)').dblclick()
  const field = page.getByRole('textbox', { name: 'Edit map(.name)' })
  await field.fill('map(.age)')
  await field.press('Enter')

  // the comment and line breaks around it are untouched
  await expect(editorLines(page)).toHaveText(['.users', '| map(.age) # names', '| unique'])
  await expect(output(page)).toHaveText('[ 36, 45 ]')
  await page.screenshot({ path: `${SCREENS}/edited.png` })
})

test('adds a stage after a node, in the pipeline’s own style', async ({ page }) => {
  await preview(page, USERS, '.users\n| map(.name)')
  await node(page, 'map: map(.name)').click()
  await action(page, 'Add a stage after map(.name)').click()
  const field = page.getByRole('textbox', { name: 'New stage after map(.name)' })
  await field.fill('length')
  await field.press('Enter')

  await expect(editorLines(page)).toHaveText(['.users', '| map(.name)', '| length'])
  // the new node is selected, so Output shows its preview
  await expect(output(page)).toHaveText('2')
  await expect(node(page, 'custom: length')).toBeFocused()
})

test('adds the first stage after the input', async ({ page }) => {
  await preview(page, USERS, '.')
  await node(page, 'source: input').click()
  await action(page, 'Add a stage after input').click()
  const field = page.getByRole('textbox', { name: 'New stage after input' })
  await field.fill('.users[0].name')
  await field.press('Enter')

  await expect(editorLines(page)).toHaveText(['. | .users[0].name'])
  await expect(output(page)).toHaveText('"ada"')
})

test('deletes a node with its pipe, leaving the rest as written', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name) | unique')
  await node(page, 'map: map(.name)').click()
  await action(page, 'Delete map(.name)').click()

  await expect(editorLines(page)).toHaveText(['.users | unique'])
  await expect(node(page, 'map: map(.name)')).toHaveCount(0)
  await expect(node(page, 'pick: .users')).toBeFocused()
})

test('undo and redo on the canvas are the editor’s', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name) | unique')
  await node(page, 'map: map(.name)').click()
  await action(page, 'Delete map(.name)').click()
  await expect(editorLines(page)).toHaveText(['.users | unique'])

  // focus is on the node before the deleted one, so the canvas takes the keys
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editorLines(page)).toHaveText(['.users | map(.name) | unique'])
  await expect(node(page, 'map: map(.name)')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editorLines(page)).toHaveText(['.users | unique'])

  // and the editor's own undo reaches the same history
  await page.getByRole('textbox', { name: 'jq filter source' }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editorLines(page)).toHaveText(['.users | map(.name) | unique'])
})

test('clearing a node’s text deletes it; Escape cancels an edit', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name) | unique')

  await node(page, 'unique: unique').dblclick()
  const field = page.getByRole('textbox', { name: 'Edit unique' })
  await field.fill('sort')
  await field.press('Escape')
  await expect(editorLines(page)).toHaveText(['.users | map(.name) | unique'])

  await node(page, 'map: map(.name)').dblclick()
  const clear = page.getByRole('textbox', { name: 'Edit map(.name)' })
  await clear.fill('')
  await clear.press('Enter')
  await expect(editorLines(page)).toHaveText(['.users | unique'])
})

test('F2 edits the selected node from the keyboard', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name)')
  await node(page, 'map: map(.name)').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('F2')
  const field = page.getByRole('textbox', { name: 'Edit map(.name)' })
  await expect(field).toBeFocused()
  await field.fill('map(.age)')
  await field.press('Enter')
  await expect(editorLines(page)).toHaveText(['.users | map(.age)'])
})
