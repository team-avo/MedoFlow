/**
 * Demo feedback WS2 — "video call is shadowed by the manual recording
 * button": in every state both controls are rendered, the recording one
 * works during a call, and when it can't be used it says why.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ConsultControls,
  type ConsultControlsProps,
  type RecordingControlState,
} from '@/components/consultation/ConsultControls'
import { LiveTranscriptPanel } from '@/components/consultation/LiveTranscriptPanel'

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
    expect(before.video.onStart).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    expect(before.recording.onStart).toHaveBeenCalledOnce()
  })

  it('in a call: Stop and End call both work', () => {
    const p = setup({ active: true }, { state: 'recording', duration: 75 })
    expect(screen.getByRole('button', { name: /stop recording/i })).toHaveTextContent('01:15')
    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))
    fireEvent.click(videoButton())
    expect(p.recording.onStop).toHaveBeenCalledOnce()
    expect(p.video.onEnd).toHaveBeenCalledOnce()
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
