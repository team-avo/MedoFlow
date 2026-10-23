/**
 * Page-editor state (F8.2): the draft being edited plus undo/redo history.
 * A pure reducer, so every editing operation is unit-tested without a DOM.
 * Typing in one field coalesces into a single undo step.
 */
import type { Section, SectionType } from './types'
import { newSection, newSectionId } from './sections'

export interface EditorDoc {
  title: string
  seoTitle: string
  seoDescription: string
  sections: Section[]
}

export interface EditorState {
  doc: EditorDoc
  past: EditorDoc[]
  future: EditorDoc[]
  selectedId: string | null
  /** JSON of the last saved doc, to know whether there are unsaved edits. */
  savedJson: string
  /** Coalescing: the last edit's field key and time. */
  lastEdit: { key: string; at: number } | null
}

export const HISTORY_LIMIT = 50
export const COALESCE_MS = 1200

export type EditorAction =
  | { type: 'load'; doc: EditorDoc }
  | { type: 'select'; id: string | null }
  | { type: 'add'; sectionType: SectionType; index?: number }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; to: number }
  | { type: 'duplicate'; id: string }
  | { type: 'toggleHidden'; id: string }
  | { type: 'variant'; id: string; variant: string }
  | { type: 'settings'; id: string; key: string; value: unknown; at?: number }
  | { type: 'meta'; key: 'title' | 'seoTitle' | 'seoDescription'; value: string; at?: number }
  | { type: 'replaceSections'; sections: Section[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; doc: EditorDoc }

export function initEditor(doc: EditorDoc): EditorState {
  return {
    doc,
    past: [],
    future: [],
    selectedId: doc.sections[0]?.id ?? null,
    savedJson: JSON.stringify(doc),
    lastEdit: null,
  }
}

export const isDirty = (s: EditorState) => JSON.stringify(s.doc) !== s.savedJson
export const canUndo = (s: EditorState) => s.past.length > 0
export const canRedo = (s: EditorState) => s.future.length > 0

function commit(
  s: EditorState,
  doc: EditorDoc,
  coalesceKey?: string,
  at = Date.now()
): EditorState {
  const merge =
    coalesceKey !== undefined &&
    s.lastEdit?.key === coalesceKey &&
    at - s.lastEdit.at < COALESCE_MS &&
    s.past.length > 0
  const past = merge ? s.past : [...s.past, s.doc].slice(-HISTORY_LIMIT)
  return { ...s, doc, past, future: [], lastEdit: coalesceKey ? { key: coalesceKey, at } : null }
}

const mapSection = (doc: EditorDoc, id: string, fn: (s: Section) => Section): EditorDoc => ({
  ...doc,
  sections: doc.sections.map((s) => (s.id === id ? fn(s) : s)),
})

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'load':
      return initEditor(a.doc)
    case 'select':
      return { ...s, selectedId: a.id, lastEdit: null }
    case 'add': {
      const sec = newSection(a.sectionType)
      const sections = [...s.doc.sections]
      const at =
        a.index === undefined ? sections.length : Math.max(0, Math.min(a.index, sections.length))
      sections.splice(at, 0, sec)
      return { ...commit(s, { ...s.doc, sections }), selectedId: sec.id }
    }
    case 'remove': {
      const idx = s.doc.sections.findIndex((x) => x.id === a.id)
      if (idx < 0) return s
      const sections = s.doc.sections.filter((x) => x.id !== a.id)
      const next = sections[Math.min(idx, sections.length - 1)]?.id ?? null
      return {
        ...commit(s, { ...s.doc, sections }),
        selectedId: s.selectedId === a.id ? next : s.selectedId,
      }
    }
    case 'move': {
      const from = s.doc.sections.findIndex((x) => x.id === a.id)
      if (from < 0) return s
      const to = Math.max(0, Math.min(a.to, s.doc.sections.length - 1))
      if (from === to) return s
      const sections = [...s.doc.sections]
      const [moved] = sections.splice(from, 1)
      sections.splice(to, 0, moved!)
      return commit(s, { ...s.doc, sections })
    }
    case 'duplicate': {
      const idx = s.doc.sections.findIndex((x) => x.id === a.id)
      if (idx < 0) return s
      const copy: Section = { ...structuredClone(s.doc.sections[idx]!), id: newSectionId() }
      const sections = [...s.doc.sections]
      sections.splice(idx + 1, 0, copy)
      return { ...commit(s, { ...s.doc, sections }), selectedId: copy.id }
    }
    case 'toggleHidden':
      return commit(
        s,
        mapSection(s.doc, a.id, (x) => ({ ...x, hidden: !x.hidden }))
      )
    case 'variant':
      return commit(
        s,
        mapSection(s.doc, a.id, (x) => ({ ...x, variant: a.variant }))
      )
    case 'settings':
      return commit(
        s,
        mapSection(s.doc, a.id, (x) => ({ ...x, settings: { ...x.settings, [a.key]: a.value } })),
        `${a.id}.${a.key}`,
        a.at
      )
    case 'meta':
      return commit(s, { ...s.doc, [a.key]: a.value }, `meta.${a.key}`, a.at)
    case 'replaceSections':
      return commit(s, { ...s.doc, sections: a.sections })
    case 'undo': {
      if (!s.past.length) return s
      const prev = s.past[s.past.length - 1]!
      return {
        ...s,
        doc: prev,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future],
        lastEdit: null,
      }
    }
    case 'redo': {
      if (!s.future.length) return s
      const [next, ...rest] = s.future
      return {
        ...s,
        doc: next!,
        past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
        future: rest,
        lastEdit: null,
      }
    }
    case 'saved':
      return { ...s, savedJson: JSON.stringify(a.doc) }
  }
}
