import { describe, expect, it } from 'vitest'
import { project } from './project.ts'

/**
 * Projection suite (CLAUDE.md > Testing). These assert node *shapes* for given
 * jq text, including the cases that must fall back to a custom filter node.
 *
 * They are `.todo` until the web-tree-sitter jq grammar is wired (TODO(wasm) in
 * project.ts). Flip each to a real assertion as the projection lands — do not
 * delete them; they are the spec for invariant 5 (unrepresentable jq degrades).
 */
describe('project — CST to graph model', () => {
  it.todo('splits a top-level pipe chain into one node per stage')
  it.todo('maps select/map/pick/sort_by/group_by/unique/limit to their kinds')
  it.todo('falls back to a custom node for reduce/foreach/def/label')
  it.todo('never throws on valid jq (invariant 5)')

  it('is not wired yet and says so rather than fabricating a model', () => {
    expect(() => project(null, '.a | .b')).toThrow(/not yet wired/)
  })
})
