import { expect, test, type Page } from '@playwright/test'
import { addStage, editorLines, node, openApp, output, preview, SCREENS, stagePane, USERS } from './app.ts'

/**
 * The Stage pane (Phase 6): the selected node as fields. A field edit splices
 * only its own argument (invariant 2); adding a stage generates only that
 * stage's text from the form.
 */
openApp()

const field = (page: Page, label: string) => stagePane(page).getByLabel(label, { exact: true })

test('edits select’s predicate, keeping the call’s own spacing', async ({ page }) => {
  await preview(page, USERS, '.users[] | select( .age > 40 ) | .name')
  await node(page, 'select: select( .age > 40 )').click()
  await expect(field(page, 'Keep items where')).toHaveValue('.age > 40')

  await field(page, 'Keep items where').fill('.age > 30')
  await field(page, 'Keep items where').press('Enter')
  await expect(editorLines(page)).toHaveText(['.users[] | select( .age > 30 ) | .name'])
  await expect(field(page, 'Keep items where')).toBeFocused()
  await page.screenshot({ path: `${SCREENS}/stage-select.png` })
})

test('edits both arguments of limit', async ({ page }) => {
  await preview(page, USERS, 'limit(1; .users[]) | .name')
  await node(page, 'limit: limit(1; .users[])').click()

  await field(page, 'Keep the first').fill('2')
  await field(page, 'Keep the first').press('Enter')
  await expect(editorLines(page)).toHaveText(['limit(2; .users[]) | .name'])

  await field(page, 'results of').fill('.users[] | select(.age > 40)')
  await field(page, 'results of').press('Enter')
  await expect(editorLines(page)).toHaveText(['limit(2; .users[] | select(.age > 40)) | .name'])
  await node(page, 'pick: .name').click()
  await expect(output(page)).toHaveText('"grace"')
})

test('adds a stage by kind, showing the jq it writes', async ({ page }) => {
  await preview(page, USERS, '.users[] | .name')
  await node(page, 'custom: .users[]').click()
  await page.getByRole('button', { name: 'Add a stage after .users[]', exact: true }).click()
  const form = page.getByRole('form', { name: 'Add a stage after .users[]' })
  await expect(form.getByRole('combobox')).toBeFocused()
  await form.getByLabel('Keep items where', { exact: true }).fill('.age > 40')
  await expect(form.locator('code')).toHaveText('select(.age > 40)')
  await page.screenshot({ path: `${SCREENS}/stage-add.png` })
  await form.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(editorLines(page)).toHaveText(['.users[] | select(.age > 40) | .name'])
  // the new stage is selected and focused, its preview in Output
  await expect(node(page, 'select: select(.age > 40)')).toBeFocused()
  await expect(output(page)).toHaveText('{ "name": "grace", "age": 45 }')
})

test('adds unique straight away: it has no fields', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name)')
  await node(page, 'map: map(.name)').click()
  await addStage(page, 'map(.name)', 'unique')
  await expect(editorLines(page)).toHaveText(['.users | map(.name) | unique'])
})

test('Escape cancels adding, writing nothing, and focus returns to the node', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name)')
  await node(page, 'map: map(.name)').click()
  await page.getByRole('button', { name: 'Add a stage after map(.name)', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('form')).toHaveCount(0)
  await expect(editorLines(page)).toHaveText(['.users | map(.name)'])
  await expect(node(page, 'map: map(.name)')).toBeFocused()
})

test('edits a custom stage as its whole jq, in a multi-line field', async ({ page }) => {
  await preview(page, USERS, 'reduce .users[] as $u (0; . + $u.age)')
  const jq = field(page, 'jq')
  await expect(jq).toHaveValue('reduce .users[] as $u (0; . + $u.age)')
  await jq.fill('reduce .users[] as $u (0; . + 1)')
  await jq.press('ControlOrMeta+Enter')
  await expect(editorLines(page)).toHaveText(['reduce .users[] as $u (0; . + 1)'])
  await expect(output(page)).toHaveText('2')
})

test('Escape in a field puts the value back, and writes nothing', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name)')
  await node(page, 'map: map(.name)').click()
  const each = field(page, 'Turn each item into')
  await each.fill('.age')
  await each.press('Escape')
  await expect(each).toHaveValue('.name')
  await node(page, 'pick: .users').click() // leaving the field doesn't commit the reverted value
  await expect(editorLines(page)).toHaveText(['.users | map(.name)'])
})

test('a field follows the document when the editor changes it', async ({ page }) => {
  await preview(page, USERS, '.users | map(.name)')
  await node(page, 'map: map(.name)').click()
  await expect(field(page, 'Turn each item into')).toHaveValue('.name')
  await preview(page, USERS, '.users | map(.age)')
  await expect(field(page, 'Turn each item into')).toHaveValue('.age')
})

test('the input node and unique have no fields', async ({ page }) => {
  await preview(page, USERS, '.users | unique')
  await node(page, 'source: input').click()
  await expect(stagePane(page)).toContainText('The input. Paste or edit it in the Input JSON pane.')
  await node(page, 'unique: unique').click()
  await expect(stagePane(page)).toContainText('unique has no settings.')
})
