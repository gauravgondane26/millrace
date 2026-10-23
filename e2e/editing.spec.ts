import { expect, test, type Page } from '@playwright/test'
import { addStage, editorLines, node, openApp, output, preview, SCREENS, USERS } from './app.ts'

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
  await addStage(page, 'map(.name)', 'custom', { jq: 'length' })

  await expect(editorLines(page)).toHaveText(['.users', '| map(.name)', '| length'])
  // the new node is selected, so Output shows its preview
  await expect(output(page)).toHaveText('2')
  await expect(node(page, 'custom: length')).toBeFocused()
})

test('adds the first stage after the input', async ({ page }) => {
  await preview(page, USERS, '.')
  await node(page, 'source: input').click()
  await addStage(page, 'input', 'pick', { Path: '.users[0].name' })

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

test.describe('edge cases', () => {
  test('clicking away commits an edit', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name)')
    await node(page, 'map: map(.name)').dblclick()
    await page.getByRole('textbox', { name: 'Edit map(.name)' }).fill('map(.age)')
    await node(page, 'pick: .users').click()
    await expect(editorLines(page)).toHaveText(['.users | map(.age)'])
  })

  test('double-clicking the input node does not edit it', async ({ page }) => {
    await preview(page, USERS, '.users')
    await node(page, 'source: input').dblclick()
    await expect(page.getByRole('region', { name: 'Pipeline' }).getByRole('textbox')).toHaveCount(0)
  })

  test('two quick edits undo one at a time', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name) | unique | length')
    await node(page, 'map: map(.name)').click()
    await action(page, 'Delete map(.name)').click()
    await node(page, 'unique: unique').click()
    await action(page, 'Delete unique').click()
    await expect(editorLines(page)).toHaveText(['.users | length'])

    await page.keyboard.press('ControlOrMeta+z')
    await expect(editorLines(page)).toHaveText(['.users | unique | length'])
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editorLines(page)).toHaveText(['.users | map(.name) | unique | length'])
  })

  test('an edit that breaks the jq shows the error on its node', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name)')
    await node(page, 'map: map(.name)').dblclick()
    const field = page.getByRole('textbox', { name: 'Edit map(.name)' })
    await field.fill('map(')
    await field.press('Enter')
    await expect(editorLines(page)).toHaveText(['.users | map('])
    await expect(node(page, 'custom: map(')).toContainText('error')
    await expect(output(page)).toHaveClass(/text-red/)
  })

  test('Tab reaches a node’s buttons, and Enter presses them', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name) | unique')
    await node(page, 'map: map(.name)').focus()
    await page.keyboard.press('Enter') // select it, revealing its buttons
    await page.keyboard.press('Tab') // Edit
    await page.keyboard.press('Tab') // Add after
    await page.keyboard.press('Tab') // Delete
    await expect(action(page, 'Delete map(.name)')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(editorLines(page)).toHaveText(['.users | unique'])
  })
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

test.describe('a canvas edit within 200 ms of typing', () => {
  // The canvas draws from the text committed 200 ms after typing stops; a
  // canvas edit in that window must splice the editor's live text at the
  // node's live range. Freezing the page's timers holds the window open.
  async function typeWithoutCommitting(page: Page, keys: () => Promise<void>) {
    await page.clock.install()
    await page.clock.pauseAt(new Date('2030-01-01T00:00:00Z'))
    await page.getByRole('textbox', { name: 'jq filter source' }).click()
    await keys()
  }
  const notice = (page: Page) => page.getByRole('banner').getByRole('status')

  test('text typed before the node moved it: the edit follows', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name)')
    await expect(output(page)).toHaveText(NAMES)
    await typeWithoutCommitting(page, async () => {
      await page.keyboard.press('ControlOrMeta+Home')
      await page.keyboard.type('. | ')
    })
    // the canvas still shows the old text, and the edit lands in the new
    await node(page, 'map: map(.name)').click()
    await action(page, 'Delete map(.name)').click()
    await expect(editorLines(page)).toHaveText(['. | .users'])
    await expect(notice(page)).toBeEmpty()
  })

  test('text typed after the node: a stage added after it goes in between', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name)')
    await expect(output(page)).toHaveText(NAMES)
    await typeWithoutCommitting(page, async () => {
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.type(' | length')
    })
    await node(page, 'map: map(.name)').click()
    await addStage(page, 'map(.name)', 'unique')
    await expect(editorLines(page)).toHaveText(['.users | map(.name) | unique | length'])
  })

  test('the node itself changed: the edit is refused, and says so', async ({ page }) => {
    await preview(page, USERS, '.users | map(.name)')
    await expect(output(page)).toHaveText(NAMES)
    await typeWithoutCommitting(page, async () => {
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.press('Backspace')
      await page.keyboard.type('.age)')
    })
    await node(page, 'map: map(.name)').click()
    await action(page, 'Delete map(.name)').click()
    await expect(editorLines(page)).toHaveText(['.users | map(.name.age)'])
    await expect(notice(page)).toHaveText('That stage changed as you typed, so the edit was not made. Try it again.')

    // once the text commits, the canvas shows the node as it is, and it can go
    await page.clock.resume()
    await node(page, 'map: map(.name.age)').click()
    await action(page, 'Delete map(.name.age)').click()
    await expect(editorLines(page)).toHaveText(['.users'])
  })
})
