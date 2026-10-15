'use client'

/**
 * AI Front Desk — Phase 1 admin page.
 *
 * Three tabs in one screen:
 *   1. Test       — talk to the agent in your browser via WebRTC + OpenAI Realtime
 *   2. Configure  — greeting, persona, voice, capabilities, business hours
 *   3. Call log   — recent calls with AI-summarized transcripts
 */

import React, { useState } from 'react'
import { Phone, Settings, ListMusic, Sparkles, Mic } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { VoiceAgentTester } from './_components/VoiceAgentTester'
import { VoiceAgentConfigForm } from './_components/VoiceAgentConfigForm'
import { VoiceAgentCallLog } from './_components/VoiceAgentCallLog'

type Tab = 'test' | 'configure' | 'log'

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'test', label: 'Test', icon: Mic },
  { id: 'configure', label: 'Configure', icon: Settings },
  { id: 'log', label: 'Call log', icon: ListMusic },
]

export default function VoiceAgentPage() {
  const [tab, setTab] = useState<Tab>('test')

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* Page header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-teal-wash px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-teal ring-1 ring-teal/20">
            <Sparkles className="h-3 w-3" strokeWidth={2.5} />
            New · Phase 1
          </div>
          <h1 className="mf-display mt-3 text-[32px] leading-tight text-navy md:text-[40px]">
            AI Front Desk
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-muted">
            Your tireless receptionist. Answers calls, books appointments, takes messages, and
            transfers to a human when it matters. Test it in your browser first — phone-number setup
            comes in Phase 2.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-hairline bg-white px-4 py-2 shadow-sm">
          <Phone className="h-4 w-4 text-teal" strokeWidth={2} />
          <span className="text-[12px] font-medium text-ink">Browser mode active</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-hairline bg-white p-1 shadow-sm w-fit">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all ${
                active
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-ink-muted hover:bg-canvas hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              {label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'test' && <VoiceAgentTester />}
        {tab === 'configure' && <VoiceAgentConfigForm />}
        {tab === 'log' && <VoiceAgentCallLog />}
      </div>
    </div>
  )
}
