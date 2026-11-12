'use client'

/**
 * The consultation room's two primary controls, always side by side and
 * always rendered (demo feedback WS2: "video call is shadowed by the manual
 * recording button — make sure both are visible and working").
 *
 *  - Video: Start call / End call.
 *  - Recording: Start / Stop, Upload & transcribe, or the processing state.
 *    It works during a call too, and when it can't be used it says why
 *    instead of disappearing.
 *
 * Sticky under the dashboard TopBar (h-14) so neither control scrolls away
 * behind the video frame.
 */
import { Mic, PhoneOff, Square, Upload, Video, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type RecordingControlState =
  | 'idle'
  | 'recording'
  | 'recorded'
  | 'uploading'
  | 'transcribing'
  | 'done'

export interface ConsultControlsProps {
  /** Omitted for an in-person visit (CTO-31): audio recording only. */
  video?: {
    active: boolean
    loading: boolean
    onStart: () => void
    onEnd: () => void
  }
  recording: {
    state: RecordingControlState
    /** Seconds recorded so far. */
    duration: number
    /** Why recording can't start right now (null = it can). */
    blockedReason: string | null
    onStart: () => void
    onStop: () => void
    onUpload: () => void
  }
}

const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

const base =
  'inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed'

export function ConsultControls({ video, recording }: ConsultControlsProps) {
  return (
    <div
      data-testid="consult-controls"
      className="sticky top-14 z-20 -mx-1 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        {!video ? null : video.active ? (
          <button
            type="button"
            onClick={video.onEnd}
            className={cn(base, 'bg-rose-600 text-white hover:bg-rose-700')}
          >
            <PhoneOff className="h-4 w-4" aria-hidden />
            End video call
          </button>
        ) : (
          <button
            type="button"
            onClick={video.onStart}
            disabled={video.loading}
            className={cn(base, 'bg-[#1E3A5F] text-white hover:bg-[#23436B] disabled:opacity-60')}
          >
            {video.loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Video className="h-4 w-4" aria-hidden />
            )}
            {video.loading ? 'Starting video call…' : 'Start video call'}
          </button>
        )}

        <RecordingButton {...recording} />
      </div>
      {recording.state === 'idle' && recording.blockedReason && (
        <p
          role="status"
          data-testid="recording-blocked-reason"
          className="mt-2 px-1 text-xs text-amber-700"
        >
          {recording.blockedReason}
        </p>
      )}
    </div>
  )
}

function RecordingButton({
  state,
  duration,
  blockedReason,
  onStart,
  onStop,
  onUpload,
}: ConsultControlsProps['recording']) {
  switch (state) {
    case 'recording':
      return (
        <button
          type="button"
          onClick={onStop}
          className={cn(base, 'bg-slate-900 text-white hover:bg-slate-800')}
        >
          <Square className="h-4 w-4 fill-current" aria-hidden />
          Stop recording
          <span className="font-mono tabular-nums text-white/70">{formatDuration(duration)}</span>
        </button>
      )
    case 'recorded':
      return (
        <button
          type="button"
          onClick={onUpload}
          className={cn(base, 'bg-[#0D9488] text-white hover:bg-[#0F766E]')}
        >
          <Upload className="h-4 w-4" aria-hidden />
          Upload &amp; transcribe
        </button>
      )
    case 'uploading':
    case 'transcribing':
      return (
        <button type="button" disabled className={cn(base, 'bg-amber-50 text-amber-800')}>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {state === 'uploading' ? 'Uploading audio…' : 'Transcribing…'}
        </button>
      )
    case 'done':
      return (
        <button type="button" disabled className={cn(base, 'bg-emerald-50 text-emerald-800')}>
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Recording sent to AI Scribe
        </button>
      )
    default:
      return (
        <button
          type="button"
          onClick={onStart}
          disabled={!!blockedReason}
          className={cn(
            base,
            blockedReason ? 'bg-slate-100 text-slate-400' : 'bg-red-600 text-white hover:bg-red-700'
          )}
        >
          <Mic className="h-4 w-4" aria-hidden />
          Start recording
        </button>
      )
  }
}
