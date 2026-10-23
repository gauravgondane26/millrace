/**
 * The in-app guide (ui/Guide): what millrace does, for people who already
 * know some jq. Plain data, so the examples can be tested: every example
 * carries what jq makes of it (`expect`), and worker/guide.test.ts runs each
 * one through the real engine. An example that stops working fails a test
 * rather than misleading a reader.
 *
 * Text is plain strings, one per paragraph; a span in backticks is code.
 */
export interface GuideSection {
  /** Unique; also the heading's anchor. */
  id: string
  title: string
  paragraphs: string[]
  /** Loaded by the section's Try it button, in place of the document. */
  example?: GuideExample
  /** A definition list (the cheat sheet): code, then what it does. */
  terms?: { code: string; meaning: string }[]
  link?: { label: string; href: string }
}

export interface GuideExample {
  /** Named in the notice after loading it. */
  name: string
  jq: string
  input: string
  /**
   * What jq makes of the whole program: its output (compact, one value per
   * line, as jq -c writes it, without the last newline), or a substring of
   * the compile error it reports.
   */
  expect: { output: string } | { compileError: string }
}

/** One input for every example, small enough to read at a glance. */
export const GUIDE_INPUT = `{
  "users": [
    {"name": "ada", "age": 36, "team": "core"},
    {"name": "grace", "age": 45, "team": "infra"},
    {"name": "linus", "age": 28, "team": "core"},
    {"name": "barbara", "age": 52, "team": "infra"}
  ]
}
`

const MANUAL = 'https://jqlang.org/manual/v1.8/'

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'input',
    title: 'Bring your data',
    paragraphs: [
      'Paste JSON into Input JSON, use Open file…, or drop a file on it. Several documents one after another are several inputs, as with jq on the command line.',
      'Previews run on a sample: every array is cut to 200 items. Input over 1 MB is shown rather than edited; paste or open a file to replace it.',
    ],
    example: {
      name: 'Bring your data',
      jq: '.users',
      input: GUIDE_INPUT,
      expect: {
        output:
          '[{"name":"ada","age":36,"team":"core"},{"name":"grace","age":45,"team":"infra"},{"name":"linus","age":28,"team":"core"},{"name":"barbara","age":52,"team":"infra"}]',
      },
    },
  },
  {
    id: 'previews',
    title: 'Every stage, previewed',
    paragraphs: [
      'The jq filter and the Pipeline are two views of one program: edit either and the other follows. Each stage between `|` pipes is a card, and each card shows what its stage outputs.',
      'Select a card to see its whole output in the Output pane; with none selected, it shows the last. Run full runs the whole program on the whole input, the exact jq answer.',
    ],
    example: {
      name: 'Every stage, previewed',
      jq: '.users | map(select(.age > 30)) | map(.name)',
      input: GUIDE_INPUT,
      expect: { output: '["ada","grace","barbara"]' },
    },
  },
  {
    id: 'editing',
    title: 'Edit on the canvas',
    paragraphs: [
      'A selected card offers Edit (or F2, or double-click) for its jq, Add after for a new stage, and Delete. The Stage pane shows the same stage as fields: `sort_by`’s key, `select`’s predicate.',
      'Each edit changes only that stage’s text, so your spacing and comments stay as you wrote them. Ctrl+Z undoes canvas edits and typing alike.',
    ],
    example: {
      name: 'Edit on the canvas',
      jq: '.users | sort_by(.age) | map(.name)',
      input: GUIDE_INPUT,
      expect: { output: '["linus","ada","grace","barbara"]' },
    },
  },
  {
    id: 'fan-out',
    title: 'Objects fan out',
    paragraphs: [
      'An object construction such as `{count: length, names: map(.name)}` fans out: each key gets a lane of its own, which runs on the same input and is previewed stage by stage. Arrays built with `[…]` get a lane too.',
    ],
    example: {
      name: 'Objects fan out',
      jq: '.users | {count: length, names: map(.name)}',
      input: GUIDE_INPUT,
      expect: { output: '{"count":4,"names":["ada","grace","linus","barbara"]}' },
    },
  },
  {
    id: 'errors',
    title: 'When something breaks',
    paragraphs: [
      'A stage that fails is underlined in the editor and says why on its card; the stages after it show as blocked. Fix the text and the previews pick up again.',
      'jq the canvas can’t draw, such as `reduce`, becomes a dashed custom card. It still runs and still shows a preview; edit it as text.',
    ],
    example: {
      name: 'When something breaks',
      jq: '.users | reduce .[] as $u (0; . + $u.age) | lenght | tostring',
      input: GUIDE_INPUT,
      expect: { compileError: 'lenght/0 is not defined' },
    },
  },
  {
    id: 'keyboard',
    title: 'Keyboard',
    paragraphs: [
      'Tab reaches every card. Enter selects the focused card, F2 edits it, and Ctrl+Z undoes. In the Stage pane, Enter commits a field and Escape puts it back. The Output view takes focus, so the arrow keys scroll it.',
    ],
  },
  {
    id: 'saving',
    title: 'Saved and shared',
    paragraphs: [
      'Your jq and input are saved in this browser as you work, and come back on reload. Share copies a link with the jq, and the input too while the link stays under 32,000 characters.',
      'Opening a link, or a Try it here, replaces your document; the notice at the top offers Undo. With the app open in several tabs, the one you changed last saves.',
    ],
  },
  {
    id: 'take-it',
    title: 'Take the jq with you',
    paragraphs: [
      'The jq is the product: the canvas only helps you write it. Copy it from the editor and run it anywhere jq runs; the previews come from jq 1.8 itself, so it behaves the same.',
      'Copy, above the Output, takes the whole output, even where the view shows only part of it.',
    ],
    link: { label: 'The jq 1.8 manual', href: MANUAL },
  },
  {
    id: 'cheat-sheet',
    title: 'jq used in these examples',
    paragraphs: [],
    terms: [
      { code: '.users', meaning: 'the value of the key users' },
      { code: '.users[]', meaning: 'each element of users, as separate outputs' },
      { code: 'f | g', meaning: 'g runs on each output of f' },
      { code: 'select(f)', meaning: 'keeps the input where f is true' },
      { code: 'map(f)', meaning: 'f applied to each element of an array' },
      { code: '{a: f}', meaning: 'an object whose key a holds the output of f' },
      { code: '[f]', meaning: 'an array of every output of f' },
      { code: 'length', meaning: 'how many elements, keys or characters' },
    ],
    link: { label: 'Everything else, in the jq manual', href: MANUAL },
  },
]
