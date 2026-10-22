import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { decodeShare, encodeShare, shareFragment } from './share.ts'

describe('share links', () => {
  it.each([
    ['plain', { source: '.users | map(.name)', input: '{"users": []}' }],
    ['jq only', { source: '.a' }],
    // whitespace, comments, unicode and number text all come back as typed
    [
      'exact text',
      {
        source: '.users\n  | map(.name)   # names\n  | unique',
        input: '{"b": 1, "10": 2, "big": 100000000000000000001, "x": 1.10}\n{"é😀": "\\u00e9"}',
      },
    ],
    ['an empty program', { source: '', input: '' }],
  ])('round-trips %s', (_, doc) => {
    expect(decodeShare(`#${encodeShare(doc)}`)).toEqual({ status: 'ok', doc })
  })

  it('makes a fragment that needs no escaping in a URL', () => {
    const fragment = encodeShare({ source: '{a: .b} | "x y" # ?&#', input: '[1, 2]' })
    expect(fragment).toMatch(/^v1=[A-Za-z0-9+\-$]+$/)
  })

  it('carries the input when it fits', () => {
    const share = shareFragment('.a', '{"a": 1}')
    expect(share.droppedInput).toBe(false)
    expect(decodeShare(share.fragment)).toEqual({ status: 'ok', doc: { source: '.a', input: '{"a": 1}' } })
  })

  it('leaves out input too big for a link, and says so', () => {
    const input = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `user ${i * 7919}` })))
    const share = shareFragment('.[0]', input, 1000)
    expect(share).toEqual({ fragment: encodeShare({ source: '.[0]' }), droppedInput: true })
  })

  it('leaves out input that compresses to more than the limit', () => {
    // hard to compress: a pseudo-random digit string a little over the limit
    let seed = 7
    const digits = Array.from({ length: 3000 }, () => ((seed = (seed * 48271) % 2147483647) % 10).toString()).join('')
    const share = shareFragment('.', `"${digits}"`, 1000)
    expect(share.droppedInput).toBe(true)
    expect(share.fragment.length).toBeLessThan(1000)
  })

  it('does not count blank input as dropped', () => {
    expect(shareFragment('.a', '  \n')).toEqual({ fragment: encodeShare({ source: '.a' }), droppedInput: false })
  })

  it('ignores a hash that is not a share link', () => {
    expect(decodeShare('')).toEqual({ status: 'none' })
    expect(decodeShare('#section-2')).toEqual({ status: 'none' })
  })

  it.each([
    ['cut short', encodeShare({ source: '.users | map(.name)', input: '[]' }).slice(0, 12)],
    ['not compressed', 'v1=hello'],
    ['not JSON', `v1=${compressToEncodedURIComponent('{nope')}`],
    ['the wrong shape', `v1=${compressToEncodedURIComponent('{"s": 1}')}`],
    ['input that is not text', `v1=${compressToEncodedURIComponent('{"s": ".", "i": [1]}')}`],
  ])('reports a link it cannot read: %s', (_, fragment) => {
    expect(decodeShare(fragment)).toEqual({ status: 'invalid' })
  })
})
