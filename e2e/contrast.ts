import type { Page } from '@playwright/test'

/** A piece of text whose contrast with what is behind it falls short of AA. */
export interface LowContrast {
  text: string
  where: string
  ratio: number
  needed: number
  color: string
  background: string
}

/**
 * WCAG AA contrast for every visible piece of text on the page, including
 * placeholders. axe leaves the canvas undecided (its cards overlap the pane
 * behind them), so this works out the background itself: the colours of the
 * element's ancestors, composited from the nearest opaque one. Every
 * background here is a flat colour, so no image or gradient is involved.
 * Disabled controls are exempt, as WCAG allows.
 */
export function lowContrast(page: Page): Promise<LowContrast[]> {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number]
    const parse = (c: string): Rgba => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m?.[1]) return [0, 0, 0, 0]
      const [r = 0, g = 0, b = 0, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return [r, g, b, a]
    }
    const over = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [
      r * a + R * (1 - a),
      g * a + G * (1 - a),
      b * a + B * (1 - a),
      1,
    ]
    const luminance = ([r, g, b]: Rgba) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    }
    const opacity = (el: Element | null): number => {
      let o = 1
      for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
      return o
    }
    const backdrop = (el: Element): Rgba => {
      const layers: Rgba[] = []
      for (let e: Element | null = el; e; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor)
        if (bg[3] > 0) layers.push(bg)
        if (bg[3] >= 1) break
      }
      let color: Rgba = [255, 255, 255, 1] // the canvas behind the page
      for (const layer of layers.reverse()) color = over(layer, color)
      return color
    }
    const describe = (el: Element) => {
      const label = el.closest('[aria-label]')?.getAttribute('aria-label')
      return `${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 4).join('.')}${label ? ` in "${label}"` : ''}`
    }

    const found: LowContrast[] = []
    const check = (el: Element, text: string, colorText: string) => {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') return
      if (el.closest(':disabled, [aria-disabled="true"], [aria-hidden="true"]')) return
      const size = parseFloat(style.fontSize)
      const bold = Number(style.fontWeight) >= 700
      const large = size >= 24 || (bold && size >= 18.66)
      const needed = large ? 3 : 4.5
      const background = backdrop(el)
      const fg = parse(colorText)
      const color = over([fg[0], fg[1], fg[2], fg[3] * opacity(el)], background)
      const r = ratio(color, background)
      if (r < needed - 0.005) {
        found.push({
          text: text.trim().slice(0, 40),
          where: describe(el),
          ratio: Math.round(r * 100) / 100,
          needed,
          color: colorText,
          background: `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`,
        })
      }
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const seen = new Set<Element>()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || seen.has(el) || !n.textContent?.trim()) continue
      if (el.closest('script, style, title')) continue
      seen.add(el)
      check(el, n.textContent, getComputedStyle(el).color)
    }
    for (const field of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))) {
      if (field.value === '' && field.placeholder) check(field, field.placeholder, getComputedStyle(field, '::placeholder').color)
    }
    return found
  })
}
