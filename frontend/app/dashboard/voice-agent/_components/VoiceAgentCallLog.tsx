'use client'

/**
 * VoiceAgentCallLog — recent calls handled by the AI front desk.
 *
 * Table of calls on the left; click a row to open a detail panel on the
 * right with the full transcript and the tool calls made during the call.
 */

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Phone,
  CheckCircle2,
  AlertCircle,
  Mic,
  Loader2,
  Sparkles,
  ChevronRight,
  X,
} from 'lucide-react'
import { voiceAgentApi, type VoiceCall } from '@/lib/voiceAgentApi'

const outcomeLabel: Record<string, string> = {
  APPOINTMENT_BOOKED: 'Booked',
  APPOINTMENT_RESCHEDULED: 'Rescheduled',
  APPOINTMENT_CANCELLED: 'Cancelled',
  MESSAGE_TAKEN: 'Message',
  REFILL_REQUESTED: 'Refill',
  INFO_PROVIDED: 'Info',
  TRANSFERRED_TO_HUMAN: 'Transferred',
  NO_ACTION: 'No action',
}

const outcomeTone: Record<string, string> = {
  APPOINTMENT_BOOKED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  APPOINTMENT_RESCHEDULED: 'bg-sky-50 text-sky-700 ring-sky-200',
  APPOINTMENT_CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
  MESSAGE_TAKEN: 'bg-amber-50 text-amber-700 ring-amber-200',
  REFILL_REQUESTED: 'bg-violet-50 text-violet-700 ring-violet-200',
  INFO_PROVIDED: 'bg-slate-50 text-slate-700 ring-slate-200',
  TRANSFERRED_TO_HUMAN: 'bg-amber-50 text-amber-700 ring-amber-200',
  NO_ACTION: 'bg-slate-50 text-slate-500 ring-slate-200',
}

function fmtDuration(sec: number) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VoiceAgentCallLog() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const {
    data: calls,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['voice-agent', 'calls'],
    queryFn: () => voiceAgentApi.listCalls(50),
    refetchInterval: 8000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-hairline bg-white p-20 shadow-card">
        <Loader2 className="h-5 w-5 animate-spin text-teal" />
      </div>
    )
  }

  if (isError || !calls) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-[13px] text-rose-700">
        Failed to load call log. Refresh to try again.
      </div>
    )
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline bg-white p-20 text-center shadow-card">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-wash text-teal">
          <Phone className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <p className="mt-4 text-[15px] font-medium text-ink">No calls yet</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          Run a test from the <span className="text-ink">Test</span> tab to see your first call
          here.
        </p>
      </div>
    )
  }

  const selected = selectedId ? calls.find((c) => c.id === selectedId) : null

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* Call list */}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div>
            <h3 className="mf-display text-[15px] text-ink">Recent calls</h3>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {calls.length} {calls.length === 1 ? 'call' : 'calls'} · refreshes every 8 seconds
            </p>
          </div>
        </header>

        <ul className="divide-y divide-hairline">
          {calls.map((call) => {
            const isSel = call.id === selectedId
            const ok = call.status === 'COMPLETED'
            return (
              <li key={call.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(call.id)}
                  className={`flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors ${
                    isSel ? 'bg-teal-wash/50' : 'hover:bg-canvas'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                      ok
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'
                    }`}
                  >
                    {ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {call.callerName ?? 'Unknown caller'}
                      <span className="ml-2 text-[11px] font-normal text-ink-muted">
                        · {call.channel === 'BROWSER' ? 'Browser test' : 'Phone'}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                      {formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}
                      {' · '}
                      {fmtDuration(call.durationSec)}
                    </p>
                  </div>

                  {call.outcome && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                        outcomeTone[call.outcome] ?? 'bg-slate-50 text-slate-700 ring-slate-200'
                      }`}
                    >
                      {outcomeLabel[call.outcome] ?? call.outcome}
                    </span>
                  )}

                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-faint" strokeWidth={2} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Detail panel */}
      {selected ? (
        <div
          key={selected.id}
          className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card"
        >
          <CallDetail call={selected} onClose={() => setSelectedId(null)} />
        </div>
      ) : (
        <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-hairline bg-white p-12 text-center text-ink-muted">
          <Sparkles className="h-5 w-5 text-teal" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] font-medium text-ink">Pick a call</p>
          <p className="mt-1 max-w-[260px] text-[12px] text-ink-muted">
            Click any call to see its transcript, AI-generated summary, and the tools the agent
            invoked.
          </p>
        </div>
      )}
    </div>
  )
}

function CallDetail({ call, onClose }: { call: VoiceCall; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between border-b border-hairline px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="mf-eyebrow text-teal">Call detail</p>
          <h3 className="mf-display mt-1 truncate text-[16px] text-ink">
            {call.callerName ?? 'Unknown caller'}
          </h3>
          <p className="mt-1 text-[11px] text-ink-muted">
            {format(new Date(call.startedAt), 'PPpp')} · {fmtDuration(call.durationSec)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Summary */}
      {call.summary ? (
        <section className="border-b border-hairline px-5 py-4">
          <p className="mf-eyebrow mb-2 text-ink-muted">AI summary</p>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">{call.summary}</p>
        </section>
      ) : call.status === 'COMPLETED' ? (
        <section className="flex items-center gap-2 border-b border-hairline px-5 py-3 text-[12px] text-ink-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Summary generating…
        </section>
      ) : null}

      {/* Transcript */}
      <section className="flex-1 overflow-y-auto px-5 py-4">
        <p className="mf-eyebrow mb-3 text-ink-muted">Transcript</p>
        {call.transcript.length === 0 ? (
          <p className="text-[12px] text-ink-faint">No transcript recorded.</p>
        ) : (
          <ul className="space-y-2.5">
            {call.transcript.map((m, i) => (
              <li key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-navy text-white'
                      : 'rounded-bl-sm bg-canvas text-ink ring-1 ring-hairline'
                  }`}
                >
                  {m.content}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tool calls */}
      {call.events && call.events.length > 0 && (
        <section className="border-t border-hairline px-5 py-4">
          <p className="mf-eyebrow mb-2 text-ink-muted">Tool calls ({call.events.length})</p>
          <ul className="space-y-1.5">
            {call.events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center gap-2 rounded-md bg-teal-wash px-2.5 py-1.5 text-[11px] text-teal"
              >
                <Mic className="h-3 w-3" strokeWidth={2.5} />
                <span className="font-mono font-medium">{ev.toolName ?? ev.type}</span>
                {ev.errorMessage && (
                  <span className="rounded-full bg-rose-100 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-rose-700">
                    error
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
