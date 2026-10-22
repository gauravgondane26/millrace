import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ADDABLE_KINDS,
  fieldsOf,
  newFieldsOf,
  stageText,
  type AddableKind,
  type Field,
} from '../core/parse/kinds.ts'
import { siblingId } from '../core/parse/graph.ts'
import type { GraphNode } from '../core/parse/model.ts'
import { nodeLabel } from './summary.ts'
import type { GraphEdits } from './useGraphEdits.ts'

/** A stage being added after `after`, the node at `index` in its chain. */
export interface Adding {
  after: GraphNode
  index: number
}

interface Props {
  selected: GraphNode | null
  edits: GraphEdits
  adding: Adding | null
  onCancelAdd: () => void
  /** A stage was added; this is its id. */
  onAdded: (id: string) => void
}

/**
 * The selected node as fields rather than raw jq (Phase 6): select's
 * predicate, map's projection, limit's count, and so on. A field edit splices
 * only its own argument, so the rest of the stage stays as written; a custom
 * stage is edited as its whole jq text (invariant 5). Also hosts the form for
 * adding a stage, where the new stage's text is the only generated text.
 */
export function StagePane({ selected: node, edits, adding, onCancelAdd, onAdded }: Props) {
  if (adding) return <AddStage adding={adding} edits={edits} onCancel={onCancelAdd} onAdded={onAdded} />

  if (!node) return null
  if (node.kind === 'source') return <Note>The input. Paste or edit it in the Input JSON pane.</Note>
  const fields = fieldsOf(node)
  if (fields.length === 0) return <Note>{node.kind} has no settings.</Note>

  return (
    <div className="flex flex-col gap-2 p-3">
      {fields.map((field, i) => {
        const value = field.target === 'whole' ? node.text : (node.args[field.target]?.text ?? '')
        return (
          <FieldInput
            key={`${node.id}:${i}`}
            field={field}
            value={value}
            onCommit={(next) =>
              field.target === 'whole'
                ? edits.replace(node.id, node.text, next)
                : edits.replaceArg(node.id, node.text, field.target, value, next)
            }
          />
        )
      })}
    </div>
  )
}

function AddStage({
  adding,
  edits,
  onCancel,
  onAdded,
}: {
  adding: Adding
  edits: GraphEdits
  onCancel: () => void
  onAdded: (id: string) => void
}) {
  const [kind, setKind] = useState<AddableKind>('select')
  const [values, setValues] = useState<string[]>([])
  const text = stageText(kind, values)
  const kindId = useId()
  const fields = newFieldsOf(kind)

  // after the last control, in reading and Tab order, so the form is no
  // taller than its fields (the Stage pane's height is fixed)
  const actions = (
    <div className="flex shrink-0 gap-2">
      <button type="submit" disabled={!text} className={button}>
        Add
      </button>
      <button type="button" onClick={onCancel} className={button}>
        Cancel
      </button>
    </div>
  )

  const add = () => {
    if (!text) return
    if (edits.insertAfter(adding.after.id, adding.after.text, text)) onAdded(siblingId(adding.after.id, adding.index + 1))
    else onCancel()
  }

  return (
    <form
      aria-label={`Add a stage after ${nodeLabel(adding.after)}`}
      className="flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={kindId} className="min-w-0 shrink truncate text-xs text-neutral-400">
          Add after <span className="font-mono text-neutral-100">{nodeLabel(adding.after)}</span>:
        </label>
        <select
          id={kindId}
          autoFocus
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as AddableKind)
            setValues([])
          }}
          className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 font-mono text-xs text-neutral-100"
        >
          {ADDABLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k === 'custom' ? 'jq (custom)' : k}
            </option>
          ))}
        </select>
        {/* the jq this adds, so the form teaches the syntax it writes */}
        <code className="ml-auto min-w-0 truncate text-xs text-neutral-400">{text ?? ''}</code>
        {fields.length === 0 && actions}
      </div>
      {fields.map((field, i) => (
        <DraftField
          key={`${kind}:${i}`}
          field={field}
          trailing={i === fields.length - 1 ? actions : null}
          value={values[i] ?? ''}
          onChange={(v) =>
            setValues((prev) => {
              const next = [...prev]
              next[i] = v
              return next
            })
          }
          onSubmit={add}
        />
      ))}
    </form>
  )
}

const button =
  'rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40'

const inputClass =
  'w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-blue-400'

/**
 * One field of an existing node. Commits on Enter (Ctrl+Enter in a multi-line
 * field) or on leaving it; Escape puts the current value back. Until it is
 * committed, typing here leaves the document alone, so each commit is one
 * undo step. While unfocused it follows the document, which may change from
 * the editor or the canvas.
 */
function FieldInput({ field, value, onCommit }: { field: Field; value: string; onCommit: (next: string) => boolean }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  const commit = () => {
    const next = draft.trim()
    if (!next || next === value || !onCommit(next)) setDraft(value)
  }
  return (
    <Labelled label={field.label}>
      {(id) => {
        const shared = {
          id,
          value: draft,
          placeholder: field.placeholder,
          spellCheck: false,
          className: inputClass,
          onFocus: () => (focused.current = true),
          onBlur: () => {
            focused.current = false
            commit()
          },
        }
        return field.multiline ? (
          <textarea
            {...shared}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') setDraft(value)
            }}
          />
        ) : (
          <input
            {...shared}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') setDraft(value)
            }}
          />
        )
      }}
    </Labelled>
  )
}

/** One field of a stage being added; the form owns its value. */
function DraftField({
  field,
  value,
  onChange,
  onSubmit,
  trailing,
}: {
  field: Field
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  /** Shown after the field, on its row: the form's buttons. */
  trailing: ReactNode
}) {
  return (
    <Labelled label={field.label} trailing={trailing}>
      {(id) =>
        field.multiline ? (
          <textarea
            id={id}
            rows={3}
            value={value}
            placeholder={field.placeholder}
            spellCheck={false}
            className={inputClass}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                onSubmit()
              }
            }}
          />
        ) : (
          <input
            id={id}
            value={value}
            placeholder={field.placeholder}
            spellCheck={false}
            className={inputClass}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Labelled>
  )
}

/** A field with its label beside it, and anything that follows it on its row. */
function Labelled({
  label,
  trailing,
  children,
}: {
  label: string
  trailing?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <label htmlFor={id} className="w-32 shrink-0 pt-1 text-xs text-neutral-400">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children(id)}</div>
      {trailing && <div className="shrink-0 self-end">{trailing}</div>}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="p-3 text-xs text-neutral-400">{children}</p>
}
