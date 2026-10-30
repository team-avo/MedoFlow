/**
 * Deterministic in-process scribe AI (AI_SCRIBE_*_PROVIDER=mock).
 *
 * For CI, the integration suites and the live front-end ↔ back-end run: the
 * whole pipeline (transcribe → label speakers → draft) runs without a key or
 * network. Tests script failures and inspect prompts through
 * `mockScribeControl`. Refused in production by the egress policy.
 * All content is synthetic.
 */
import { AiError } from './errors'
import type {
  CallOptions,
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderDescriptor,
  SpeechToTextProvider,
  TranscriptionInput,
  TranscriptionResult,
} from './types'

export const MOCK_MODEL = 'mock-scribe-1'

export const MOCK_TRANSCRIPT = [
  'Provider: How have you been since the last visit?',
  'Patient: Better. The fatigue is easing, but I still feel low on energy by mid-afternoon.',
  'Provider: Any trouble sleeping?',
  'Patient: A little. I wake up around three most nights.',
  'Provider: Your energy is improving, so we will keep the plan. Take vitamin D3 5000 IU daily, one bottle,',
  'and magnesium glycinate 400 mg at night, two bottles. Let us recheck in six weeks.',
].join('\n')

/** The prompt section the scribe adds when the patient has prior approved visits (FR-7). */
export const PRIOR_VISITS_MARKER = 'PRIOR APPROVED VISITS'

export function mockAnalysis(userPrompt: string): Record<string, unknown> {
  const hasPrior = userPrompt.includes(PRIOR_VISITS_MARKER)
  return {
    soap: {
      subjective:
        'Reports easing fatigue with persistent mid-afternoon low energy. Wakes around 3 a.m. most nights.',
      objective: 'Alert and well appearing. No acute distress.',
      assessment: 'Fatigue, improving on the current plan. Sleep maintenance difficulty.',
      plan: 'Continue vitamin D3 5000 IU daily and magnesium glycinate 400 mg at night. Recheck in six weeks.',
    },
    timeline: {
      symptoms: ['fatigue', 'afternoon low energy', 'night waking'],
      duration: 'ongoing, improving',
      assessment: 'Fatigue, improving',
      plan: [
        'Vitamin D3 5000 IU daily',
        'Magnesium glycinate 400 mg nightly',
        'Recheck in 6 weeks',
      ],
    },
    orders: [
      { name: 'Vitamin D3', dose: '5000 IU', quantity: 1 },
      { name: 'Magnesium glycinate', dose: '400 mg', quantity: 2 },
    ],
    continuity: hasPrior ? 'Since the last visit: fatigue is improving on the same plan.' : null,
    patientSummary: {
      diagnosis: 'Your tiredness is getting better.',
      treatmentPlan: 'Keep taking vitamin D3 every day and magnesium at night.',
      nextSteps: 'Book a check-up in about six weeks.',
    },
  }
}

export interface MockCall {
  kind: 'llm' | 'stt'
  request?: CompletionRequest
  mimeType?: string
  bytes?: number
}

type MockFailure = { on: 'llm' | 'stt'; error: AiError }

export const mockScribeControl = {
  calls: [] as MockCall[],
  failures: [] as MockFailure[],
  /** Overrides the LLM's answer; return undefined to fall through to the default. */
  llmResponder: undefined as ((req: CompletionRequest) => string | undefined) | undefined,
  /** Fail the next `times` calls of a kind with this AiError code. */
  failNext(on: 'llm' | 'stt', code: AiError['code'], times = 1): void {
    for (let i = 0; i < times; i += 1) this.failures.push({ on, error: new AiError(code) })
  },
  reset(): void {
    this.calls = []
    this.failures = []
    this.llmResponder = undefined
  },
}

function takeFailure(on: 'llm' | 'stt'): AiError | null {
  const i = mockScribeControl.failures.findIndex((f) => f.on === on)
  if (i < 0) return null
  return mockScribeControl.failures.splice(i, 1)[0]!.error
}

const descriptor = (): ProviderDescriptor => ({
  kind: 'mock',
  preset: 'mock',
  host: null,
  model: MOCK_MODEL,
  location: 'in-process',
})

export class MockLlm implements LlmProvider {
  describe(): ProviderDescriptor {
    return descriptor()
  }

  complete(req: CompletionRequest, opts: CallOptions = {}): Promise<CompletionResult> {
    mockScribeControl.calls.push({ kind: 'llm', request: req })
    if (opts.signal?.aborted) return Promise.reject(new AiError('ai_timeout'))
    const failure = takeFailure('llm')
    if (failure) return Promise.reject(failure)
    const custom = mockScribeControl.llmResponder?.(req)
    if (custom !== undefined) return Promise.resolve({ text: custom, model: MOCK_MODEL })
    // The draft (and its repair pass) asks for the scribe schema; anything else
    // is the speaker-labelling pass, which returns the dialogue as given.
    const text = req.jsonSchema ? JSON.stringify(mockAnalysis(req.user)) : req.user
    return Promise.resolve({ text, model: MOCK_MODEL })
  }
}

export class MockStt implements SpeechToTextProvider {
  describe(): ProviderDescriptor {
    return descriptor()
  }

  transcribe(input: TranscriptionInput, opts: CallOptions = {}): Promise<TranscriptionResult> {
    mockScribeControl.calls.push({
      kind: 'stt',
      mimeType: input.mimeType,
      bytes: input.audio.length,
    })
    if (opts.signal?.aborted) return Promise.reject(new AiError('ai_timeout'))
    const failure = takeFailure('stt')
    if (failure) return Promise.reject(failure)
    return Promise.resolve({ text: MOCK_TRANSCRIPT, model: MOCK_MODEL })
  }
}
