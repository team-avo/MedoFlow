'use client'

/** The page's section list: drag (or keyboard) to reorder, hide, duplicate, delete, add. */
import React from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, Eye, EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react'
import * as Popover from '@radix-ui/react-dialog'
import type { Section, SectionType } from '@/lib/site/types'
import { SECTION_BY_TYPE, SECTION_DEFS } from '@/lib/site/sections'
import { cn } from '@/lib/utils'
import type { EditorAction } from '@/lib/site/editorState'

function summary(s: Section): string {
  const v = s.settings
  const text = [v.headline, v.heading, v.title].find((x) => typeof x === 'string' && x.trim())
  return typeof text === 'string' ? text : (SECTION_BY_TYPE.get(s.type)?.description ?? '')
}

function Row({
  section,
  selected,
  dispatch,
  index,
  total,
}: {
  section: Section
  selected: boolean
  dispatch: React.Dispatch<EditorAction>
  index: number
  total: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  })
  const def = SECTION_BY_TYPE.get(section.type)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`section-row-${section.type}`}
      className={cn(
        'group flex items-center gap-1 rounded-xl border bg-white px-1.5 py-1.5 text-sm',
        selected
          ? 'border-indigo-500 ring-2 ring-indigo-100'
          : 'border-slate-200 hover:border-slate-300',
        isDragging && 'z-10 shadow-lg',
        section.hidden && 'opacity-60'
      )}
    >
      <button
        type="button"
        className="cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
        aria-label={`Reorder ${def?.label ?? section.type} (position ${index + 1} of ${total})`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => dispatch({ type: 'select', id: section.id })}
      >
        <div className="truncate font-semibold text-slate-800">{def?.label ?? section.type}</div>
        <div className="truncate text-xs text-slate-500">{summary(section)}</div>
      </button>
      <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => dispatch({ type: 'toggleHidden', id: section.id })}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={section.hidden ? 'Show section' : 'Hide section'}
        >
          {section.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'duplicate', id: section.id })}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Duplicate section"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'remove', id: section.id })}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          aria-label="Delete section"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  )
}

export function AddSectionMenu({ onAdd }: { onAdd: (t: SectionType) => void }) {
  const [open, setOpen] = React.useState(false)
  const groups = ['Intro', 'Your clinic', 'Content', 'Conversion', 'Layout'] as const
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
        >
          <Plus className="h-4 w-4" /> Add section
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay className="fixed inset-0 z-50 bg-slate-900/30" />
        <Popover.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(46rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
          <Popover.Title className="text-lg font-semibold text-slate-900">
            Add a section
          </Popover.Title>
          <Popover.Description className="mb-4 text-sm text-slate-500">
            Sections fill with your clinic’s real services, team and products automatically.
          </Popover.Description>
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  {g}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SECTION_DEFS.filter((d) => d.group === g).map((d) => (
                    <button
                      key={d.type}
                      type="button"
                      onClick={() => {
                        onAdd(d.type)
                        setOpen(false)
                      }}
                      className="rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-400 hover:bg-indigo-50/40"
                    >
                      <div className="text-sm font-semibold text-slate-900">{d.label}</div>
                      <div className="text-xs text-slate-500">{d.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function SectionTree({
  sections,
  selectedId,
  dispatch,
}: {
  sections: Section[]
  selectedId: string | null
  dispatch: React.Dispatch<EditorAction>
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const to = sections.findIndex((s) => s.id === e.over!.id)
    dispatch({ type: 'move', id: String(e.active.id), to })
  }
  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1.5" aria-label="Page sections">
            {sections.map((s, i) => (
              <Row
                key={s.id}
                section={s}
                selected={s.id === selectedId}
                dispatch={dispatch}
                index={i}
                total={sections.length}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <AddSectionMenu
        onAdd={(t) => {
          const at = selectedId
            ? sections.findIndex((s) => s.id === selectedId) + 1
            : sections.length
          dispatch({ type: 'add', sectionType: t, index: at })
        }}
      />
    </div>
  )
}
