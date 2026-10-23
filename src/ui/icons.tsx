/**
 * Icons for the header's icon buttons, drawn here (no icon dependency).
 * Decorative: the button carries the name (aria-label) and a tooltip (title).
 */
const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/** An open book: the guide. */
export function BookIcon() {
  return (
    <svg {...svg}>
      <path d="M10 5.5C8.5 4.3 6 4 2.5 4.2v11c3.5-.2 6 .1 7.5 1.3 1.5-1.2 4-1.5 7.5-1.3v-11C14 4 11.5 4.3 10 5.5z" />
      <path d="M10 5.5v11" />
    </svg>
  )
}

/** Three linked dots: share. */
export function ShareIcon() {
  return (
    <svg {...svg}>
      <circle cx="14.5" cy="4.5" r="2.25" />
      <circle cx="5.5" cy="10" r="2.25" />
      <circle cx="14.5" cy="15.5" r="2.25" />
      <path d="M12.6 5.7 7.4 8.8M7.4 11.2l5.2 3.1" />
    </svg>
  )
}

/** A square button holding only an icon, in the style of the canvas's zoom buttons. */
export const iconButton =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-500 text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400'
