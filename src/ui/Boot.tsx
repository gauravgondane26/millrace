import { useEffect, useState } from 'react'
import { App } from './App.tsx'
import { restoreDocument } from './persist.ts'

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
  if (ready) return <App />
  return (
    <div className="flex h-full items-center justify-center bg-neutral-950">
      <p role="status" className="text-sm text-neutral-400">
        Opening your document…
      </p>
    </div>
  )
}
