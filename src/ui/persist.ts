import type { EditorView } from '@codemirror/view'
import { decodeShare } from '../core/persist/share.ts'
import { openSpec } from '../core/splice/transaction.ts'
import { useAppStore } from './store.ts'

/**
 * The working document survives a reload: its jq and its input are kept in
 * IndexedDB, and nothing else is (CLAUDE.md > Scope). The store stays the
 * only live state (invariant 1); this file fills it once at startup and
 * then follows it.
 *
 * The jq and the input are separate records, so typing jq never rewrites a
 * large input.
 */
type Field = 'source' | 'input'

interface DocumentStore {
  load(): Promise<Partial<Record<Field, string>>>
  save(field: Field, value: string): Promise<void>
}

const DB_NAME = 'millrace'
const STORE = 'document'
/** Opening can hang (another tab blocking an upgrade): give up after this. */
const OPEN_TIMEOUT_MS = 3000
/** Saves wait for a pause this long in typing. */
const SAVE_DELAY_MS = 300

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })

/** The document store, or null where the browser won't keep one. */
async function openDocumentStore(): Promise<DocumentStore | null> {
  try {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('IndexedDB took too long to open')), OPEN_TIMEOUT_MS),
    )
    const db = await Promise.race([request(open), timeout])
    const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE)
    return {
      async load() {
        const [source, input] = await Promise.all([
          request(store('readonly').get('source') as IDBRequest<unknown>),
          request(store('readonly').get('input') as IDBRequest<unknown>),
        ])
        return {
          ...(typeof source === 'string' ? { source } : {}),
          ...(typeof input === 'string' ? { input } : {}),
        }
      },
      async save(field, value) {
        const tx = db.transaction(STORE, 'readwrite')
        const put = request(tx.objectStore(STORE).put(value, field))
        // commit now rather than when the task ends: a save made as the page
        // unloads otherwise often dies with it
        tx.commit?.()
        await put
      },
    }
  } catch {
    // no indexedDB at all, storage blocked, or a private window that refuses it
    return null
  }
}

/**
 * Tabs open on the document agree which one saves it, over a BroadcastChannel
 * (messages between tabs; nothing is stored): the tab that changed it last.
 * A change claims saving and tells the others, which stop saving and say so
 * (store `savingElsewhere`) until they take it back (`saveHere`). Restoring
 * the saved document at startup changes nothing, so opening a tab claims
 * nothing; a saving tab that closes releases it.
 */
type Message = { type: 'claim' | 'release'; tab: string }
const CHANNEL = 'millrace-document'

/** Take saving back from another tab: this tab's document is saved at once. */
let takeOver: (() => void) | null = null
export const saveHere = () => takeOver?.()

/**
 * Saves the jq and the input as they change, once typing pauses, and right
 * away when the page is hidden (the last chance before a tab closes).
 *
 * While the page is hidden or unloading, a change is saved at once rather
 * than after the pause: the editor commits the text still inside its reparse
 * debounce on those same events (JqEditor), and that change may reach the
 * store after this file's own listener has already flushed.
 */
function startAutosave(db: DocumentStore, stored: Partial<Record<Field, string>>) {
  const onError = () => useAppStore.getState().setNotice(NOTICES.saveFailed)
  const pending = new Map<Field, string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let leaving = false
  const flush = () => {
    clearTimeout(timer)
    for (const [field, value] of pending) db.save(field, value).catch(onError)
    pending.clear()
  }

  const tab = Math.random().toString(36).slice(2)
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
  /** `idle` until this tab changes the document; `passive` once another tab did since. */
  let role: 'idle' | 'saving' | 'passive' = 'idle'
  const post = (type: Message['type']) => channel?.postMessage({ type, tab } satisfies Message)
  const claim = () => {
    if (role === 'saving') return
    role = 'saving'
    post('claim')
    useAppStore.getState().setSavingElsewhere(false)
  }
  if (channel) {
    channel.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.tab === tab) return
      if (e.data.type === 'claim') {
        // what this tab hasn't saved yet would land over the other tab's work
        role = 'passive'
        clearTimeout(timer)
        pending.clear()
        useAppStore.getState().setSavingElsewhere(true)
      } else if (role === 'passive') {
        role = 'idle'
        useAppStore.getState().setSavingElsewhere(false)
      }
    }
  }

  const queue = (field: Field, value: string) => {
    if (value === stored[field]) return // as saved: restoring, say, changes nothing
    stored[field] = value
    if (role === 'passive') return
    claim()
    pending.set(field, value)
    clearTimeout(timer)
    if (leaving || document.visibilityState === 'hidden') flush()
    else timer = setTimeout(flush, SAVE_DELAY_MS)
  }
  takeOver = () => {
    claim()
    const { source, inputText } = useAppStore.getState()
    pending.set('source', source)
    pending.set('input', inputText)
    flush()
  }
  useAppStore.subscribe((state, prev) => {
    if (state.source !== prev.source) queue('source', state.source)
    if (state.inputText !== prev.inputText) queue('input', state.inputText)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', () => {
    leaving = true
    flush()
    if (role === 'saving') post('release')
  })
  window.addEventListener('pageshow', (e) => {
    // back from the back/forward cache: the page lives on, without the claim
    leaving = false
    if (e.persisted && role === 'saving') role = 'idle'
  })
}

/** Drops a share link's fragment once read, so a reload doesn't reopen it over newer work. */
export function clearShareHash() {
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
}

export const NOTICES = {
  opened: 'Opened the shared link.',
  openedJqOnly: 'Opened the shared link: its jq, with your own input.',
  replaced: 'Opened the shared link in place of your document.',
  replacedJq: 'Opened the shared link’s jq in place of yours, keeping your input.',
  restored: 'Back to your document.',
  unreadable: 'That link could not be read (it may have been cut short). Showing your last document.',
  noStorage: 'This browser is not letting millrace save, so your work lasts only until the tab closes.',
  saveFailed: 'Saving failed, so a reload may lose recent changes.',
} as const


/** A document as saved: its jq and its input, either of which may be missing. */
interface Doc {
  source?: string
  input?: string
}

/**
 * The document a shared link replaced, kept for this session so the
 * notice's Undo can bring it back (the input pane has no undo of its own).
 */
let previous: Doc | null = null

/**
 * Keeps `current` for Undo before a shared document replaces it, unless
 * there is nothing to lose; says whether it did.
 */
export function keepPrevious(current: Doc, shared: Doc): boolean {
  const lost =
    (current.source !== undefined && current.source !== shared.source) ||
    (shared.input !== undefined && current.input !== undefined && current.input !== '' && current.input !== shared.input)
  previous = lost ? current : null
  return lost
}

/**
 * Opens a document in place of the one in the app (a share link pasted into
 * an open tab, a guide example): the jq through the editor, as one undoable
 * step (openSpec), and the input, if it has one, into the input pane. The
 * document it replaces is kept, so the notice can offer Undo for both;
 * `notice` says what happened, given whether there was anything to keep.
 */
export function openDocument(view: EditorView, doc: { source: string; input?: string }, notice: (replaced: boolean) => string) {
  const { setNotice, setInputText, selectNode, inputText } = useAppStore.getState()
  const kept = keepPrevious({ source: view.state.doc.toString(), input: inputText }, doc)
  view.dispatch(openSpec(view.state.doc, doc.source))
  if (doc.input !== undefined) setInputText(doc.input)
  selectNode(null)
  setNotice(notice(kept), kept ? 'restorePrevious' : null)
}

/**
 * Undo for opening a document: the jq goes back through the editor, as one
 * undoable step like the opening was, and the input back into its pane.
 */
export function restorePrevious(view: EditorView | null) {
  const doc = previous
  if (!doc || !view) return
  previous = null
  const { setInputText, setNotice, selectNode } = useAppStore.getState()
  if (doc.source !== undefined) view.dispatch(openSpec(view.state.doc, doc.source))
  if (doc.input !== undefined) setInputText(doc.input)
  selectNode(null)
  setNotice(NOTICES.restored)
}

let restoring: Promise<void> | null = null

/**
 * Fills the store with the document to start from, once per page: a share
 * link if the URL holds one, otherwise the last saved document, otherwise
 * the defaults, and posts a notice when there is something to say. The app
 * renders only after this, so a default document is never saved over the
 * stored one, and the editor starts from the restored text with no undo
 * step for it.
 */
export function restoreDocument(): Promise<void> {
  restoring ??= (async () => {
    const db = await openDocumentStore()
    const saved: Partial<Record<Field, string>> = db ? await db.load().catch(() => ({})) : {}
    const shared = decodeShare(location.hash)
    if (shared.status !== 'none') clearShareHash()

    // following the store from here saves a shared document as the working one
    if (db) startAutosave(db, { ...saved })

    const doc = shared.status === 'ok' ? { ...saved, source: shared.doc.source, ...inputOf(shared.doc) } : saved
    const kept = shared.status === 'ok' && keepPrevious(saved, shared.doc)
    useAppStore.setState({
      ...(doc.source !== undefined ? { source: doc.source } : {}),
      ...(doc.input !== undefined ? { inputText: doc.input } : {}),
    })

    const notice =
      shared.status === 'ok'
        ? openedNotice(shared.doc, kept)
        : shared.status === 'invalid'
          ? NOTICES.unreadable
          : db
            ? null
            : NOTICES.noStorage
    useAppStore.getState().setNotice(notice, kept ? 'restorePrevious' : null)
  })()
  return restoring
}

const inputOf = (doc: { input?: string }) => (doc.input === undefined ? {} : { input: doc.input })

/** What opening a shared document says, given whether it replaced one (and so offers Undo). */
export function openedNotice(shared: Doc, replaced: boolean): string {
  if (shared.input === undefined) return replaced ? NOTICES.replacedJq : NOTICES.openedJqOnly
  return replaced ? NOTICES.replaced : NOTICES.opened
}
