'use client'

/**
 * Live captions on the provider's screen while recording (demo feedback WS2,
 * refined by CTO-41).
 *
 *  - `panel`: the running transcript, auto-scrolling, with timestamps and
 *    speaker labels where the speech-to-text provider gives them.
 *  - `strip`: the last two turns, shown directly *below* the video so it
 *    never covers the call's own toolbar.
 *
 * A preview only: the clinical transcript is made from the whole recording
 * after the consult, and it is what the note is drafted from.
 *
 * The measured caption delay sits behind a toggle and outside the live region:
 * a number changing every couple of seconds must not be read out by a screen
 * reader, nor distract during a consultation that may be screen-shared.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Captions, AlertTriangle, Timer } from 'lucide-react'
import type { LiveLine, LiveSpeaker, LiveTurn } from '@/hooks/useLiveTranscription'
import type { CaptionLatencyStats } from '@/lib/liveCaptionStats'
import { cn } from '@/lib/utils'

export interface LiveTranscriptPanelProps {
  lines: LiveLine[]
  active: boolean
  delayed: boolean
  error: string | null
  /** Measured caption delay (CTO-41). Omitted: no delay affordance is shown. */
  stats?: CaptionLatencyStats
  variant?: 'panel' | 'strip'
  className?: string
}

const stamp = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

/** Never render a speaker straight from the provider's output. */
const SPEAKER_LABEL: Record<LiveSpeaker, string> = {
  PROVIDER: 'Provider:',
  PATIENT: 'Patient:',
}

/** The headline target agreed for CTO-41: first-word p95 under four seconds. */
const FIRST_WORD_TARGET_MS = 4_000

/**
 * One derivation for both variants. Without it the panel would render `turns`
 * while the strip rendered `text`, and the two caption surfaces on the same
 * screen could disagree.
 */
const turnsOf = (l: LiveLine): LiveTurn[] =>
  l.turns?.length ? l.turns : [{ speaker: null, text: l.text }]

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

function SpeakerTag({ speaker }: { speaker: LiveSpeaker | null }) {
  if (!speaker) return null
  return (
    <span
      data-testid="caption-speaker"
      className={cn(
        'shrink-0 text-[11px] font-semibold uppercase tracking-wide',
        speaker === 'PROVIDER' ? 'text-[#0D9488]' : 'text-slate-500'
      )}
    >
      {SPEAKER_LABEL[speaker]}
    </span>
  )
}

export function LiveTranscriptPanel({
  lines,
  active,
  delayed,
  error,
  stats,
  variant = 'panel',
  className,
}: LiveTranscriptPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)
  const [showDelay, setShowDelay] = useState(false)
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [lines.length])

  // Only the rounded figures, so the text changes when the number does and not
  // on every sample.
  const delaySummary = useMemo(() => {
    if (!stats || stats.samples === 0) return null
    const parts: string[] = []
    if (stats.firstWord) {
      parts.push(`Delay p50 ${seconds(stats.firstWord.p50)} · p95 ${seconds(stats.firstWord.p95)}`)
    }
    if (stats.roundTrip) {
      parts.push(
        `round-trip p50 ${seconds(stats.roundTrip.p50)} · p95 ${seconds(stats.roundTrip.p95)}`
      )
    }
    parts.push(`${stats.samples} captions`)
    if (stats.segmentMs) parts.push(`segment ${seconds(stats.segmentMs)}`)
    if (stats.dropped > 0) parts.push(`${stats.dropped} skipped`)
    if (stats.excluded > 0) parts.push(`${stats.excluded} not counted`)
    if (stats.throttled) parts.push('backed off')
    return parts.join(' · ')
  }, [stats])

  const overTarget = !!stats?.firstWord && stats.firstWord.p95 > FIRST_WORD_TARGET_MS

  if (variant === 'strip') {
    // The last two *turns*, so a two-speaker segment does not wipe the
    // previous line off a two-line strip.
    const last = lines.flatMap((l) => turnsOf(l).map((t, i) => ({ ...t, key: `${l.seq}-${i}` })))
    const shown = last.slice(-2)
    return (
      <div
        data-testid="live-caption-strip"
        aria-hidden
        className={cn(
          'min-h-[3.5rem] rounded-2xl bg-slate-900 px-4 py-2.5 text-sm leading-snug text-white',
          className
        )}
      >
        {shown.length > 0 ? (
          shown.map((t) => (
            <p key={t.key}>
              {/* The space is literal, not a margin: the text content has to
                  read "Provider: words" for anything reading it as text. */}
              {t.speaker && (
                <span data-testid="caption-speaker" className="font-semibold text-white/70">
                  {SPEAKER_LABEL[t.speaker]}
                </span>
              )}
              {t.speaker ? ' ' : ''}
              {t.text}
            </p>
          ))
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
        <div className="flex items-center gap-2">
          {delaySummary && (
            <button
              type="button"
              data-testid="caption-latency-toggle"
              onClick={() => setShowDelay((v) => !v)}
              aria-expanded={showDelay}
              aria-label="Caption delay details"
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                overTarget
                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              )}
            >
              <Timer className="h-3 w-3" aria-hidden />
              Delay
            </button>
          )}
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              active ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'
            )}
          >
            {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
            {active ? 'Live' : 'Off'}
          </span>
        </div>
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
          lines.map((l) =>
            turnsOf(l).map((t, i) => (
              <p key={`${l.seq}-${i}`} className="flex gap-3">
                {/* The time belongs to the segment, so only its first turn shows it. */}
                <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                  {i === 0 ? stamp(l.at) : ''}
                </span>
                <span className="text-slate-800">
                  <SpeakerTag speaker={t.speaker} />
                  {t.speaker ? ' ' : ''}
                  {t.text}
                </span>
              </p>
            ))
          )
        )}
        <div ref={endRef} />
      </div>
      {showDelay && delaySummary && (
        // Outside the log and silent: aria-live="off" so the figure is never
        // announced as it updates. Screen readers reach it by navigation.
        <p
          data-testid="caption-latency"
          aria-live="off"
          aria-atomic="true"
          className={cn(
            'border-t px-5 py-2 font-mono text-[11px] tabular-nums',
            overTarget
              ? 'border-amber-100 bg-amber-50 text-amber-800'
              : 'border-slate-100 bg-slate-50 text-slate-500'
          )}
        >
          {delaySummary}
        </p>
      )}
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
        Live preview: the final transcript is generated from the full recording after the consult.
        Speaker labels are a best guess.
      </p>
    </section>
  )
}
