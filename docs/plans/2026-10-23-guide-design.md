# In-app guide: design

Validated with the user in brainstorming on 2026-10-23; built the same day.

## Problem

A new visitor has no way to learn what millrace does: that the jq and the
canvas are two views of one program, that every stage has a preview, that
cards can be edited, that objects fan out into lanes, and so on.

## Decisions (the user's)

- **Form:** an in-app guide panel, with a **Try it** button on each section.
- **Audience:** people who know some jq. It teaches the app, not jq.
- **Placement:** a non-modal side drawer; the app stays usable beside it.
- **Discovery:** a Guide button in the header, and a hint in the empty
  Output pane. Nothing new is stored, so the persistence scope is unchanged.
- **Try it:** replaces the document as one undoable step, with Undo in the
  notice: the mechanism share links already use.
- **Content:** eight sections and a jq cheat sheet.

## Content

`src/core/guide/sections.ts`: plain data, no React. Each section has an id,
a title, paragraphs (plain strings; a span in backticks is code, so no
Markdown dependency) and optionally an example, a definition list or a
link. Every example shares one small input (four users with name, age and
team) and carries `expect`: jq's compact output, or a substring of the
compile error it reports.

1. Bring your data (`.users`)
2. Every stage, previewed (`.users | map(select(.age > 30)) | map(.name)`)
3. Edit on the canvas (`.users | sort_by(.age) | map(.name)`)
4. Objects fan out (`.users | {count: length, names: map(.name)}`)
5. When something breaks
   (`.users | reduce .[] as $u (0; . + $u.age) | lenght | tostring`: a
   custom card that runs, a compile error, and a blocked stage after it)
6. Keyboard
7. Saved and shared
8. Take the jq with you (link to the jq 1.8 manual)
9. jq used in these examples (a definition list)

## Loading an example

`openDocument(view, doc, notice)` in `src/ui/persist.ts`, moved out of
`useSharedLinks.ts` so share links and Try it share it: keep the current
document for Undo (`keepPrevious`), dispatch the jq through the editor
(`openSpec`, one undoable step), set the input, clear the selection, and
post the notice ("Loaded the example: <name>.") with Undo when something
was kept. Loading an example is a change, so under the multi-tab rule this
tab claims saving, with no new code.

## The drawer

`src/ui/Guide.tsx`: Radix Dialog with `modal={false}`, in three parts so the
trigger sits in the header and the panel over the panes. The panel lies in a
positioned box around `<main>`, 22rem wide at the right edge (full width
under `md`), so opening it moves no pane and the header's notice and Undo
stay visible. Interacting outside doesn't close it; Escape closes it only
with focus in the drawer (or on nothing), so Escape in the editor or a field
keeps its meaning. Radix returns focus to the Guide button on close. Try it
leaves the drawer open with focus on the button. Sections are `h3`s under
the dialog's title, deliberately not landmark regions.

## Tests

- `src/worker/guide.test.ts`: every example through the real jq 1.8.2;
  `expect` holds.
- `src/core/guide/sections.test.ts`: unique ids and names, closed code
  spans, and through the real parser: section 2 is a plain chain, section 4
  an object with two lanes, section 5 has the `reduce` as a custom card.
- `e2e/guide.spec.ts`: opens from the header and the hint; Try it loads and
  previews and leaves it open; Undo and Ctrl+Z bring the document back;
  Escape closes it and returns focus, but not Escape in the editor; no pane
  moves; full-width sheet at 390 px; axe and AA contrast while open.
