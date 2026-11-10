'use client'

/**
 * Live captions on the provider's screen while recording (demo feedback WS2).
 *
 *  - `panel`: the running transcript, auto-scrolling, with timestamps.
 *  - `strip`: the last two lines, shown directly *below* the video so it
 *    never covers the call's own toolbar.
 *
 * A preview only: the clinical transcript is made from the whole recording
 * after the consult, and it is what the note is drafted from.
 */
import { useEffect, useRef } from 'react'
import { Captions, AlertTriangle } from 'lucide-react'
import type { LiveLine } from '@/hooks/useLiveTranscription'
import { cn } from '@/lib/utils'

export interface LiveTranscriptPanelProps {
  lines: LiveLine[]
  active: boolean
  delayed: boolean
  error: string | null
  variant?: 'panel' | 'strip'
  className?: string
}

const stamp = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

export function LiveTranscriptPanel({
  lines,
  active,
  delayed,
  error,
  variant = 'panel',
  className,
}: LiveTranscriptPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [lines.length])

  if (variant === 'strip') {
    const last = lines.slice(-2)
    return (
      <div
        data-testid="live-caption-strip"
        aria-hidden
        className={cn(
          'min-h-[3.5rem] rounded-2xl bg-slate-900 px-4 py-2.5 text-sm leading-snug text-white',
          className
        )}
      >
        {last.length > 0 ? (
          last.map((l) => <p key={l.seq}>{l.text}</p>)
        ) : (
          <p className="text-white/50">
            {active
              ? 'Listening… captions appear in a few seconds'
              : 'Captions start when you record'}
          </p>
        )}
      </div>
    )
  }

  return (
    <section
      data-testid="live-transcript"
      aria-labelledby="live-transcript-heading"
      className={cn('overflow-hidden rounded-3xl border border-slate-200 bg-white', className)}
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2
          id="live-transcript-heading"
          className="flex items-center gap-2 text-sm font-bold text-slate-900"
        >
          <Captions className="h-4 w-4 text-[#0D9488]" aria-hidden />
          Live transcript
        </h2>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            active ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'
          )}
        >
          {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
          {active ? 'Live' : 'Off'}
        </span>
      </header>
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="max-h-80 space-y-2 overflow-y-auto px-5 py-4 text-sm leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-slate-400">
            {active
              ? 'Listening… the first lines appear a few seconds after you speak.'
              : 'Start recording and what is said appears here as you speak.'}
          </p>
        ) : (
          lines.map((l) => (
            <p key={l.seq} className="flex gap-3">
              <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                {stamp(l.at)}
              </span>
              <span className="text-slate-800">{l.text}</span>
            </p>
          ))
        )}
        <div ref={endRef} />
      </div>
      {(delayed || error) && (
        <p
          role="status"
          className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error ?? 'Captions are running behind; some lines were skipped.'}
        </p>
      )}
      <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400">
        Live preview — the final transcript is generated from the full recording after the consult.
      </p>
    </section>
  )
}
