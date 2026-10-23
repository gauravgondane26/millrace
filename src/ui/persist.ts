import { decodeShare } from '../core/persist/share.ts'
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
 * Saves the jq and the input as they change, once typing pauses, and right
 * away when the page is hidden (the last chance before a tab closes).
 *
 * While the page is hidden or unloading, a change is saved at once rather
 * than after the pause: the editor commits the text still inside its reparse
 * debounce on those same events (JqEditor), and that change may reach the
 * store after this file's own listener has already flushed.
 */
function startAutosave(db: DocumentStore) {
  const onError = () => useAppStore.getState().setNotice(NOTICES.saveFailed)
  const pending = new Map<Field, string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let leaving = false
  const flush = () => {
    clearTimeout(timer)
    for (const [field, value] of pending) db.save(field, value).catch(onError)
    pending.clear()
  }
  const queue = (field: Field, value: string) => {
    pending.set(field, value)
    clearTimeout(timer)
    if (leaving || document.visibilityState === 'hidden') flush()
    else timer = setTimeout(flush, SAVE_DELAY_MS)
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
  })
  // back from the back/forward cache: the page lives on
  window.addEventListener('pageshow', () => (leaving = false))
}

/** Drops a share link's fragment once read, so a reload doesn't reopen it over newer work. */
export function clearShareHash() {
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
}

export const NOTICES = {
  opened: 'Opened the shared link.',
  openedJqOnly: 'Opened the shared link: its jq, with your own input.',
  unreadable: 'That link could not be read (it may have been cut short). Showing your last document.',
  noStorage: 'This browser is not letting millrace save, so your work lasts only until the tab closes.',
  saveFailed: 'Saving failed, so a reload may lose recent changes.',
} as const


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
    if (db) startAutosave(db)

    const doc = shared.status === 'ok' ? { ...saved, source: shared.doc.source, ...inputOf(shared.doc) } : saved
    useAppStore.setState({
      ...(doc.source !== undefined ? { source: doc.source } : {}),
      ...(doc.input !== undefined ? { inputText: doc.input } : {}),
    })

    const notice =
      shared.status === 'ok'
        ? shared.doc.input === undefined
          ? NOTICES.openedJqOnly
          : NOTICES.opened
        : shared.status === 'invalid'
          ? NOTICES.unreadable
          : db
            ? null
            : NOTICES.noStorage
    useAppStore.getState().setNotice(notice)
  })()
  return restoring
}

const inputOf = (doc: { input?: string }) => (doc.input === undefined ? {} : { input: doc.input })
