'use client'

/** The consultation transcript (FR-3), shown to the provider only — never to the patient. */
import React from 'react'
import { FileText } from 'lucide-react'
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from '@/components/ui-system'
import { ScrollArea } from '@/components/ui/scroll-area'

export function TranscriptCard({
  transcript,
  sttModel,
}: {
  transcript: string
  sttModel?: string | null
}) {
  return (
    <AppCard
      className="overflow-hidden border-none bg-white shadow-sm"
      role="region"
      aria-label="Transcript"
    >
      <AppCardHeader className="flex flex-row items-center justify-between border-b-0 bg-slate-50/50 px-6 py-4">
        <AppCardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-400">
          <FileText className="h-4 w-4" />
          Transcript
        </AppCardTitle>
        {sttModel && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {sttModel}
          </span>
        )}
      </AppCardHeader>
      <AppCardContent className="p-0">
        <ScrollArea className="h-[400px] w-full p-6">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{transcript}</p>
        </ScrollArea>
      </AppCardContent>
    </AppCard>
  )
}
