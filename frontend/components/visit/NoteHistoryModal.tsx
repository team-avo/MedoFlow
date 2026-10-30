'use client'

import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { format } from 'date-fns'

interface NoteVersion {
  id: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  createdAt: string
  createdBy: {
    name: string
  }
}

interface NoteHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  versions: NoteVersion[]
  /** The visit record's current version, marked "Current". */
  currentVersionId?: string | null
  /** The versions are still loading (not "no history"). */
  isLoading?: boolean
}

/**
 * Every approved version of the note, newest first (B2.5). Versions are
 * immutable: an amendment is a new entry here, never an edit of an old one.
 */
export function NoteHistoryModal({
  isOpen,
  onClose,
  versions: unsorted,
  currentVersionId,
  isLoading = false,
}: NoteHistoryModalProps) {
  // Newest first, whatever order the API returned.
  const versions = [...unsorted].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Note Version History</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-8 py-4">
            {isLoading ? (
              <p className="text-center text-muted-foreground py-8">Loading versions…</p>
            ) : versions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No history available for this note.
              </p>
            ) : (
              versions.map((version, index) => (
                <div key={version.id} className="relative pl-6 border-l border-slate-200">
                  <div className="absolute left-[-5px] top-0 h-2.5 w-2.5 rounded-full bg-slate-400" />
                  <div className="mb-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      Version {versions.length - index}
                      {(currentVersionId ? version.id === currentVersionId : index === 0) && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Current
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {format(new Date(version.createdAt), 'PPP p')} by {version.createdBy.name}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 rounded-lg p-4">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Subjective
                      </h4>
                      <p className="text-sm whitespace-pre-wrap">{version.subjective || '-'}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Objective
                      </h4>
                      <p className="text-sm whitespace-pre-wrap">{version.objective || '-'}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Assessment
                      </h4>
                      <p className="text-sm whitespace-pre-wrap">{version.assessment || '-'}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Plan
                      </h4>
                      <p className="text-sm whitespace-pre-wrap">{version.plan || '-'}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
