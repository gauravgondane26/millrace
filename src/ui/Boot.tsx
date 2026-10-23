import { lazy, Suspense, useEffect, useState } from 'react'
import { restoreDocument } from './persist.ts'

// The app (CodeMirror, React Flow, the parser) is most of the code. Its
// download starts here, at once, in parallel with the restore, and this
// shell paints without waiting for it.
const loading = import('./App.tsx')
const App = lazy(() => loading.then((m) => ({ default: m.App })))

/**
 * Restores the working document (or opens a shared link) before the app
 * renders, so the editor starts from that text and a default document is
 * never saved over the stored one.
 */
export function Boot() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    const done = () => live && setReady(true)
    // restoring never leaves the app unopened: at worst it starts empty
    restoreDocument().then(done, done)
    return () => {
      live = false
    }
  }, [])
  const opening = (
    <div className="flex h-full items-center justify-center bg-neutral-950">
      <p role="status" className="text-sm text-neutral-400">
        Opening your document…
      </p>
    </div>
  )
  if (!ready) return opening
  return (
    <Suspense fallback={opening}>
      <App />
    </Suspense>
  )
}
