import type { EditorView } from '@codemirror/view'
import * as Dialog from '@radix-ui/react-dialog'
import { useRef, type ReactNode, type RefObject } from 'react'
import { GUIDE_SECTIONS, type GuideExample, type GuideSection } from '../core/guide/sections.ts'
import { BookIcon, iconButton } from './icons.tsx'
import { openDocument } from './persist.ts'
import { useAppStore } from './store.ts'

/**
 * The guide: a drawer over the right edge of the panes (full width on narrow
 * screens) that teaches the app, section by section, each with an example
 * to try. It is not modal: the app stays usable beside it, so a reader can
 * press Try it and watch the canvas. Whether it is open is UI state in the
 * store; nothing about it is saved.
 *
 * Three parts, so the button can sit in the header and the drawer over the
 * panes: `GuideRoot` wraps both.
 */
export function GuideRoot({ children }: { children: ReactNode }) {
  const open = useAppStore((s) => s.guideOpen)
  const setOpen = useAppStore((s) => s.setGuideOpen)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      {children}
    </Dialog.Root>
  )
}

/** Opens and closes the guide; focus comes back here when it closes. */
export function GuideButton() {
  return (
    <Dialog.Trigger aria-label="Guide" title="Guide" className={`${iconButton} aria-expanded:bg-neutral-800`}>
      <BookIcon />
    </Dialog.Trigger>
  )
}

/**
 * The drawer. Place it in a positioned box over the panes: it overlays them,
 * so opening it moves nothing.
 */
export function GuidePanel({ editor }: { editor: RefObject<EditorView | null> }) {
  const panel = useRef<HTMLDivElement>(null)
  return (
    <Dialog.Content
      ref={panel}
      // working in the app beside it doesn't close it
      onInteractOutside={(e) => e.preventDefault()}
      // nor does Escape meant for the editor or a field: only with focus in
      // the guide, or nowhere in particular
      onEscapeKeyDown={(e) => {
        const focused = document.activeElement
        if (focused && focused !== document.body && !panel.current?.contains(focused)) e.preventDefault()
      }}
      // slides in and out (Radix keeps it mounted until the closing animation
      // ends); with reduced motion it just appears and goes
      className="absolute inset-y-0 right-0 z-30 flex w-[22rem] flex-col border-l border-neutral-500 bg-neutral-900 text-neutral-100 shadow-2xl focus:outline-none max-md:w-full max-md:border-l-0 motion-safe:data-[state=closed]:animate-guide-out motion-safe:data-[state=open]:animate-guide-in"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <Dialog.Title className="flex-1 text-sm font-semibold">Guide</Dialog.Title>
        <Dialog.Close
          aria-label="Close the guide"
          className="rounded px-1.5 text-sm text-neutral-400 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          ×
        </Dialog.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <Dialog.Description className="pt-3 text-sm text-neutral-300">
          How millrace works, for anyone who knows some jq. Try it loads a section’s example in place of your
          document; Undo at the top brings yours back.
        </Dialog.Description>
        {GUIDE_SECTIONS.map((section) => (
          <Section key={section.id} section={section} editor={editor} />
        ))}
      </div>
    </Dialog.Content>
  )
}

function Section({ section, editor }: { section: GuideSection; editor: RefObject<EditorView | null> }) {
  // unnamed, so not a landmark: the panes are the page's regions, and the
  // headings are enough to move between sections
  return (
    <section className="mt-4 border-t border-neutral-800 pt-3">
      <h3 className="text-sm font-semibold text-neutral-100">
        {section.title}
      </h3>
      {section.paragraphs.map((p) => (
        <p key={p} className="mt-2 text-sm leading-relaxed text-neutral-300">
          <Prose text={p} />
        </p>
      ))}
      {section.terms && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          {section.terms.map((t) => (
            <div key={t.code} className="contents">
              <dt>
                <Code>{t.code}</Code>
              </dt>
              <dd className="text-neutral-300">{t.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
      {section.example && <Example example={section.example} title={section.title} editor={editor} />}
      {section.link && (
        <a
          href={section.link.href}
          target="_blank"
          rel="noopener"
          className="mt-2 inline-block rounded text-sm text-blue-400 underline underline-offset-2 hover:text-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          {section.link.label}
        </a>
      )}
    </section>
  )
}

function Example({ example, title, editor }: { example: GuideExample; title: string; editor: RefObject<EditorView | null> }) {
  const tryIt = () => {
    const view = editor.current
    if (!view) return
    // one undoable step for the jq, and Undo in the notice for both (as a share link)
    openDocument(view, { source: example.jq, input: example.input }, () => `Loaded the example: ${example.name}.`)
  }
  return (
    <div className="mt-2 flex items-start gap-2">
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-100">
        {example.jq}
      </pre>
      <button
        type="button"
        aria-label={`Try it: ${title}`}
        onClick={tryIt}
        className="shrink-0 rounded border border-neutral-500 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
      >
        Try it
      </button>
    </div>
  )
}

/** A paragraph's text, with its backticked spans as code. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 === 1 ? <Code key={i}>{part}</Code> : part,
      )}
    </>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-neutral-800 px-1 font-mono text-[0.85em] text-neutral-100">{children}</code>
}
