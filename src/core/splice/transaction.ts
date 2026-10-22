import { Annotation, Transaction, type ChangeSpec, type TransactionSpec } from '@codemirror/state'

/**
 * Invariant 6: every editor transaction that originates from a graph edit
 * carries this annotation, so the text-change handler can tell it apart from
 * the user typing (see core/parse/schedule).
 */
export const graphEdit = Annotation.define<boolean>()

/**
 * The transaction for a graph edit. It goes through the editor like any other
 * change, so CodeMirror's history records it and undo covers graph and text
 * edits alike (invariant 7). Never write the store directly from a graph edit.
 *
 * `changes` are UTF-16 offsets, the same unit as a node's TextRange, so a
 * projected node's range can be passed straight through.
 *
 * The `graph.edit` user event also keeps each graph edit its own undo step:
 * CodeMirror's history only merges `input.type…` and `delete…` events (and
 * unlabelled ones), so don't relabel these as either.
 */
export function graphEditSpec(changes: ChangeSpec): TransactionSpec {
  return {
    changes,
    annotations: [graphEdit.of(true), Transaction.userEvent.of('graph.edit')],
  }
}
