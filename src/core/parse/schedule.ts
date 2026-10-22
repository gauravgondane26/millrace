import type { Transaction } from '@codemirror/state'
import { graphEdit } from '../splice/transaction.ts'

/** Invariant 6: text edits are debounced this long before reparse. */
export const TEXT_REPARSE_DEBOUNCE_MS = 200

/**
 * How the source should be re-committed after a batch of editor transactions:
 * - `none`: nothing in the document changed (selection, focus, ...)
 * - `immediate`: a graph edit, undo, redo, or opening a shared link. These
 *   are discrete actions, so the graph re-derives at once instead of waiting
 *   out the debounce.
 * - `debounce`: the user typed, so wait for a pause before reparsing.
 */
export type Reparse = 'none' | 'debounce' | 'immediate'

export function reparseFor(transactions: readonly Transaction[]): Reparse {
  let kind: Reparse = 'none'
  for (const tr of transactions) {
    if (!tr.docChanged) continue
    if (tr.annotation(graphEdit) || tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.isUserEvent('open')) {
      return 'immediate'
    }
    kind = 'debounce'
  }
  return kind
}
