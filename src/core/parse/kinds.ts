import type { GraphNode, NodeKind } from './model.ts'

/**
 * How each node kind is edited as fields rather than raw jq (Phase 6), and
 * the text of a stage created from scratch: the only text the app generates
 * (invariant 2).
 */
export interface Field {
  label: string
  placeholder: string
  /** The call argument it edits, or the node's whole text. */
  target: number | 'whole'
  multiline?: boolean
}

/** Kinds a new stage can be: everything but the input. */
export type AddableKind = Exclude<NodeKind, 'source'>

export const ADDABLE_KINDS: readonly AddableKind[] = [
  'select',
  'map',
  'pick',
  'sort_by',
  'group_by',
  'unique',
  'limit',
  'custom',
]

const PATH: Field = { label: 'Path', placeholder: '.users', target: 'whole' }
const JQ: Field = { label: 'jq', placeholder: '.', target: 'whole', multiline: true }

const FIELDS: Record<AddableKind, readonly Field[]> = {
  select: [{ label: 'Keep items where', placeholder: '.age > 30', target: 0 }],
  map: [{ label: 'Turn each item into', placeholder: '.name', target: 0 }],
  pick: [PATH],
  sort_by: [{ label: 'Sort by', placeholder: '.age', target: 0 }],
  group_by: [{ label: 'Group by', placeholder: '.team', target: 0 }],
  unique: [],
  limit: [
    { label: 'Keep the first', placeholder: '10', target: 0 },
    { label: 'results of', placeholder: '.[]', target: 1 },
  ],
  custom: [JQ],
}

/** The fields an existing node is edited through. */
export function fieldsOf(node: GraphNode): readonly Field[] {
  if (node.kind === 'source') return []
  // `pick(paths)` edits its argument; a plain path `.a.b` is the whole text
  if (node.kind === 'pick' && node.args.length > 0) {
    return [{ label: 'Keep only', placeholder: '.id, .name', target: 0 }]
  }
  return FIELDS[node.kind]
}

/** The fields of a new stage of this kind. */
export const newFieldsOf = (kind: AddableKind): readonly Field[] => FIELDS[kind]

/**
 * The text of a new stage from its field values, or null while a field it
 * needs is empty. Values are used as typed: they are jq.
 */
export function stageText(kind: AddableKind, values: readonly string[]): string | null {
  const [a = '', b = ''] = values.map((v) => v.trim())
  switch (kind) {
    case 'unique':
      return 'unique'
    case 'limit':
      return a && b ? `limit(${a}; ${b})` : null
    case 'pick':
    case 'custom':
      return a || null
    default:
      return a ? `${kind}(${a})` : null
  }
}
