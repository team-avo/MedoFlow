/**
 * Demo feedback WS2: "video call is shadowed by the manual recording
 * button": in every state both controls are rendered, the recording one
 * works during a call, and when it can't be used it says why.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ConsultControls,
  type ConsultControlsProps,
  type RecordingControlState,
} from '@/components/consultation/ConsultControls'
import { LiveTranscriptPanel } from '@/components/consultation/LiveTranscriptPanel'
import type { CaptionLatencyStats } from '@/lib/liveCaptionStats'

function setup(
  video: Partial<ConsultControlsProps['video']> = {},
  recording: Partial<ConsultControlsProps['recording']> = {}
) {
  const props: ConsultControlsProps = {
    video: { active: false, loading: false, onStart: vi.fn(), onEnd: vi.fn(), ...video },
    recording: {
      state: 'idle',
      duration: 0,
      blockedReason: null,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onUpload: vi.fn(),
      ...recording,
    },
  }
  render(<ConsultControls {...props} />)
  return props
}

const videoButton = () => screen.getByRole('button', { name: /video call/i })

describe('ConsultControls: both controls, every state', () => {
  const states: [RecordingControlState, RegExp][] = [
    ['idle', /start recording/i],
    ['recording', /stop recording/i],
    ['recorded', /upload & transcribe/i],
    ['uploading', /uploading audio/i],
    ['transcribing', /transcribing/i],
    ['done', /sent to ai scribe/i],
  ]
  for (const inCall of [false, true]) {
    for (const [state, label] of states) {
      it(`${inCall ? 'in a call' : 'before a call'} · recording ${state}`, () => {
        setup({ active: inCall }, { state })
        expect(videoButton()).toHaveTextContent(inCall ? /end video call/i : /start video call/i)
        expect(screen.getByRole('button', { name: label })).toBeVisible()
      })
    }
  }

  it('starts and ends the call, and records during it', () => {
    const before = setup()
    fireEvent.click(videoButton())
    expect(before.video!.onStart).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    expect(before.recording.onStart).toHaveBeenCalledOnce()
  })

  it('in a call: Stop and End call both work', () => {
    const p = setup({ active: true }, { state: 'recording', duration: 75 })
    expect(screen.getByRole('button', { name: /stop recording/i })).toHaveTextContent('01:15')
    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))
    fireEvent.click(videoButton())
    expect(p.recording.onStop).toHaveBeenCalledOnce()
    expect(p.video!.onEnd).toHaveBeenCalledOnce()
  })

  it('a blocked recording stays visible, disabled, with its reason', () => {
    setup({}, { blockedReason: 'Waiting for the patient’s consent.' })
    expect(screen.getByRole('button', { name: /start recording/i })).toBeDisabled()
    expect(screen.getByTestId('recording-blocked-reason')).toHaveTextContent(/consent/)
    expect(videoButton()).toBeEnabled()
  })

  it('a starting call shows progress and cannot be double-started', () => {
    setup({ loading: true })
    expect(videoButton()).toBeDisabled()
    expect(videoButton()).toHaveTextContent(/starting/i)
  })
})

describe('LiveTranscriptPanel', () => {
  const lines = [
    { seq: 0, at: 0, text: 'Provider: How have you been?' },
    { seq: 1, at: 6, text: 'Patient: Better, thanks.' },
    { seq: 2, at: 12, text: 'Provider: Any trouble sleeping?' },
  ]

  it('shows every line with its time, and says it is a preview', () => {
    render(<LiveTranscriptPanel lines={lines} active delayed={false} error={null} />)
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent('0:00Provider: How have you been?')
    expect(log).toHaveTextContent('0:12Provider: Any trouble sleeping?')
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText(/final transcript is generated/i)).toBeInTheDocument()
  })

  it('explains the empty states and surfaces delays and failures', () => {
    const { rerender } = render(
      <LiveTranscriptPanel lines={[]} active={false} delayed={false} error={null} />
    )
    expect(screen.getByText(/start recording/i)).toBeInTheDocument()
    rerender(<LiveTranscriptPanel lines={[]} active delayed error={null} />)
    expect(screen.getByText(/listening/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/running behind/)
    rerender(<LiveTranscriptPanel lines={[]} active delayed={false} error="AI busy" />)
    expect(screen.getByRole('status')).toHaveTextContent('AI busy')
  })

  it('the strip under the video shows only the last two lines', () => {
    render(
      <LiveTranscriptPanel variant="strip" lines={lines} active delayed={false} error={null} />
    )
    const strip = screen.getByTestId('live-caption-strip')
    expect(strip).not.toHaveTextContent('How have you been')
    expect(strip).toHaveTextContent('Better, thanks.')
    expect(strip).toHaveTextContent('Any trouble sleeping?')
  })
})

describe('LiveTranscriptPanel: speaker labels and delay (CTO-41)', () => {
  const lines = [
    { seq: 0, at: 0, text: 'Provider: How have you been?' },
    { seq: 1, at: 6, text: 'Patient: Better, thanks.' },
  ]

  const stats = (over: Partial<CaptionLatencyStats> = {}): CaptionLatencyStats => ({
    samples: 42,
    dropped: 0,
    excluded: 0,
    firstWord: { p50: 1_900, p95: 3_400 },
    roundTrip: { p50: 800, p95: 1_600 },
    segmentMs: 2_500,
    throttled: false,
    ...over,
  })

  const turnLines = [
    {
      seq: 0,
      at: 0,
      text: 'Provider: How have you been? Patient: Better, thanks.',
      turns: [
        { speaker: 'PROVIDER' as const, text: 'How have you been?' },
        { speaker: 'PATIENT' as const, text: 'Better, thanks.' },
      ],
    },
  ]

  it('splits a segment into labelled turns under one timestamp', () => {
    render(<LiveTranscriptPanel lines={turnLines} active delayed={false} error={null} />)
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent('Provider: How have you been?')
    expect(log).toHaveTextContent('Patient: Better, thanks.')
    // The time belongs to the segment, not to each turn.
    expect(screen.getAllByText('0:00')).toHaveLength(1)
  })

  it('a turn with no speaker renders without a label', () => {
    render(
      <LiveTranscriptPanel
        lines={[
          {
            seq: 0,
            at: 0,
            text: 'two bottles should last',
            turns: [{ speaker: null, text: 'two bottles should last' }],
          },
        ]}
        active
        delayed={false}
        error={null}
      />
    )
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent('two bottles should last')
    expect(log).not.toHaveTextContent('Provider:')
    expect(log).not.toHaveTextContent('Patient:')
  })

  it('shows no delay affordance without stats, or before the first caption', () => {
    const { rerender } = render(
      <LiveTranscriptPanel lines={lines} active delayed={false} error={null} />
    )
    expect(screen.queryByTestId('caption-latency-toggle')).not.toBeInTheDocument()
    rerender(
      <LiveTranscriptPanel
        lines={[]}
        active
        delayed={false}
        error={null}
        stats={stats({ samples: 0 })}
      />
    )
    expect(screen.queryByTestId('caption-latency-toggle')).not.toBeInTheDocument()
  })

  it('reveals p50 and p95 only when asked', async () => {
    render(
      <LiveTranscriptPanel lines={lines} active delayed={false} error={null} stats={stats()} />
    )
    expect(screen.queryByTestId('caption-latency')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /caption delay/i }))
    const readout = screen.getByTestId('caption-latency')
    expect(readout).toHaveTextContent('Delay p50 1.9s · p95 3.4s')
    expect(readout).toHaveTextContent('round-trip p50 0.8s · p95 1.6s')
    expect(readout).toHaveTextContent('42 captions')
  })

  it('reports skipped segments and a back-off beside the figures', async () => {
    render(
      <LiveTranscriptPanel
        lines={lines}
        active
        delayed={false}
        error={null}
        stats={stats({ dropped: 3, throttled: true })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /caption delay/i }))
    const readout = screen.getByTestId('caption-latency')
    // Dropped segments must be visible: excluding them flatters the percentile.
    expect(readout).toHaveTextContent('3 skipped')
    expect(readout).toHaveTextContent('backed off')
  })

  it('the delay figure is never announced, and never sits inside the live region', async () => {
    render(
      <LiveTranscriptPanel lines={lines} active delayed={false} error={null} stats={stats()} />
    )
    await userEvent.click(screen.getByRole('button', { name: /caption delay/i }))
    const readout = screen.getByTestId('caption-latency')
    expect(readout).toHaveAttribute('aria-live', 'off')
    // Inside role="log" it would be read out every couple of seconds.
    expect(screen.getByRole('log')).not.toContainElement(readout)
    expect(screen.getByRole('button', { name: /caption delay/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('warns when the first-word p95 misses the four-second target', async () => {
    render(
      <LiveTranscriptPanel
        lines={lines}
        active
        delayed={false}
        error={null}
        stats={stats({ firstWord: { p50: 3_000, p95: 7_200 } })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /caption delay/i }))
    expect(screen.getByTestId('caption-latency').className).toMatch(/amber/)
  })

  it('the strip under the video never shows numbers', () => {
    render(
      <LiveTranscriptPanel
        variant="strip"
        lines={turnLines}
        active
        delayed={false}
        error={null}
        stats={stats()}
      />
    )
    const strip = screen.getByTestId('live-caption-strip')
    expect(strip).not.toHaveTextContent('p95')
    // The separator must be a real space, not just a CSS margin, or anything
    // reading the strip as text gets "Provider:How have you been?".
    expect(strip).toHaveTextContent('Provider: How have you been?')
    expect(strip).toHaveTextContent('Patient: Better, thanks.')
  })
})

describe('in person (CTO-31)', () => {
  it('shows audio recording only, with no video controls', () => {
    const recording = {
      state: 'idle' as const,
      duration: 0,
      blockedReason: null,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onUpload: vi.fn(),
    }
    render(<ConsultControls recording={recording} />)
    expect(screen.queryByRole('button', { name: /video call/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    expect(recording.onStart).toHaveBeenCalledOnce()
  })
})
