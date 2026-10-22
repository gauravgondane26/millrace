import { create } from 'zustand'

/**
 * Invariant 1: the jq source text is the only mutable application state. The
 * CST and graph model are derived from it, never stored alongside it. This
 * store holds that one source string plus genuinely-derived-free UI bits
 * (which input sample is loaded, which node is selected) — nothing that
 * duplicates the pipeline.
 */
interface AppState {
  /** The single source of truth. Everything on the canvas is projected from it. */
  source: string
  /**
   * Called only by the editor's update listener (ui/JqEditor). Anything else
   * that changes the text, graph edits included, must dispatch a CodeMirror
   * transaction instead, or undo stops covering it (invariant 7).
   */
  setSource: (next: string) => void

  /** Raw JSON the user pasted, as text. */
  inputText: string
  setInputText: (next: string) => void

  selectedNodeId: string | null
  selectNode: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  source: '.',
  setSource: (next) => set({ source: next }),
  inputText: '',
  setInputText: (next) => set({ inputText: next }),
  selectedNodeId: null,
  selectNode: (id) => set({ selectedNodeId: id }),
}))
