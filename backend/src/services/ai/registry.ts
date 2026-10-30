/**
 * The scribe's providers, built once from AI_SCRIBE_* configuration (B2.1).
 * The pipeline calls `getScribeAi()` and never names a vendor.
 */
import { AiError } from './errors'
import { isScribeDemoEnabled, loadScribeAiConfig, type ScribeAiConfig } from './config'
import { MockLlm, MockStt } from './mock'
import { OpenAiCompatibleLlm, OpenAiCompatibleStt } from './openaiCompatible'
import type { LlmProvider, ProviderDescriptor, ScribeAi, SpeechToTextProvider } from './types'

const disabledDescriptor = (): ProviderDescriptor => ({
  kind: 'disabled',
  preset: 'disabled',
  host: null,
  model: '',
  location: 'in-process',
})

class DisabledLlm implements LlmProvider {
  describe() {
    return disabledDescriptor()
  }
  complete(): Promise<never> {
    return Promise.reject(new AiError('ai_not_configured'))
  }
}

class DisabledStt implements SpeechToTextProvider {
  describe() {
    return disabledDescriptor()
  }
  transcribe(): Promise<never> {
    return Promise.reject(new AiError('ai_not_configured'))
  }
}

export function buildScribeAi(cfg: ScribeAiConfig, fetchImpl?: typeof fetch): ScribeAi {
  const deps = { timeoutMs: cfg.timeoutMs, fetchImpl }
  const llm: LlmProvider =
    cfg.llm.kind === 'mock'
      ? new MockLlm()
      : cfg.llm.kind === 'openai-compatible'
        ? new OpenAiCompatibleLlm(cfg.llm, deps)
        : new DisabledLlm()
  const stt: SpeechToTextProvider =
    cfg.stt.kind === 'mock'
      ? new MockStt()
      : cfg.stt.kind === 'openai-compatible'
        ? new OpenAiCompatibleStt(cfg.stt, deps)
        : new DisabledStt()
  return { llm, stt }
}

let current: { ai: ScribeAi; cfg: ScribeAiConfig } | null = null

function ensure(): { ai: ScribeAi; cfg: ScribeAiConfig } {
  if (!current) {
    const cfg = loadScribeAiConfig()
    current = { ai: buildScribeAi(cfg), cfg }
  }
  return current
}

export function getScribeAi(): ScribeAi {
  return ensure().ai
}

export function getScribeAiConfig(): ScribeAiConfig {
  return ensure().cfg
}

/** Re-read configuration (tests; a config change otherwise needs a restart). */
export function resetScribeAi(): void {
  current = null
}

/** Tests only: install specific providers. */
export function setScribeAiForTests(ai: ScribeAi): void {
  current = { ai, cfg: loadScribeAiConfig() }
}

export interface ScribeCapabilities {
  /** Recording + transcription + drafting all work. */
  available: boolean
  transcriptionAvailable: boolean
  draftingAvailable: boolean
  demoEnabled: boolean
  stt: Pick<ProviderDescriptor, 'kind' | 'preset' | 'model' | 'location'>
  llm: Pick<ProviderDescriptor, 'kind' | 'preset' | 'model' | 'location'>
}

const publicView = (d: ProviderDescriptor) => ({
  kind: d.kind,
  preset: d.preset,
  model: d.model,
  location: d.location,
})

/** What the UI may know: no hosts, URLs or keys. */
export function scribeCapabilities(): ScribeCapabilities {
  const { llm, stt } = getScribeAi()
  const l = llm.describe()
  const s = stt.describe()
  const transcriptionAvailable = s.kind !== 'disabled'
  const draftingAvailable = l.kind !== 'disabled'
  return {
    available: transcriptionAvailable && draftingAvailable,
    transcriptionAvailable,
    draftingAvailable,
    demoEnabled: isScribeDemoEnabled(),
    stt: publicView(s),
    llm: publicView(l),
  }
}

/** Provenance string stored on the session (FR-15), e.g. "openai-compatible:openai@api.openai.com". */
export function provenance(d: ProviderDescriptor): string {
  return d.host ? `${d.kind}:${d.preset}@${d.host}` : `${d.kind}:${d.preset}`
}
