import { useEffect, useMemo, useRef, useState } from 'react'

/** `leading-5`: every line is this tall, which is what makes windowing exact. */
const LINE_HEIGHT = 20
/** Lines drawn beyond each edge of the view, so fast scrolling shows no gap. */
const OVERSCAN = 40
/** `p-3` */
const PADDING = 12
/**
 * Most characters drawn of one line. Laying out a megabyte-long line (compact
 * output is one value per line) stalls the page; the rest is marked, and
 * Copy still takes it whole.
 */
const MAX_LINE = 5000

const clip = (line: string) =>
  line.length <= MAX_LINE ? line : `${line.slice(0, MAX_LINE)} … (${(line.length - MAX_LINE).toLocaleString()} more characters)`

/**
 * Text that may run to megabytes (a preview is up to ~1 MB compact, several
 * times that pretty-printed), drawn a window of lines at a time: only what is
 * on screen is in the DOM, so showing or scrolling it never stalls the page.
 * Lines don't wrap; a long one scrolls sideways, sized in `ch` from the
 * longest line. It takes focus, so the keyboard can scroll it.
 */
export function TextView({ text, className = '' }: { text: string; className?: string }) {
  const { lines, widest } = useMemo(() => {
    const lines = text.split('\n')
    if (lines.at(-1) === '') lines.pop()
    let widest = 0
    for (const line of lines) widest = Math.max(widest, Math.min(line.length, MAX_LINE + 40))
    return { lines, widest }
  }, [text])

  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 0 })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setView({ top: el.scrollTop, height: el.clientHeight }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [])

  const first = Math.max(0, Math.floor((view.top - PADDING) / LINE_HEIGHT) - OVERSCAN)
  const last = Math.min(lines.length, Math.ceil((view.top + view.height) / LINE_HEIGHT) + OVERSCAN)

  return (
    <div
      ref={scroller}
      tabIndex={0}
      className={`h-full w-full overflow-auto font-mono text-sm leading-5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400 ${className}`}
    >
      <div
        className="relative"
        style={{ height: lines.length * LINE_HEIGHT + 2 * PADDING, minWidth: `calc(${widest}ch + ${2 * PADDING}px)` }}
      >
        <pre
          className="absolute left-0 top-0 whitespace-pre px-3"
          style={{ transform: `translateY(${PADDING + first * LINE_HEIGHT}px)` }}
        >
          {lines.slice(first, last).map(clip).join('\n')}
        </pre>
      </div>
    </div>
  )
}
