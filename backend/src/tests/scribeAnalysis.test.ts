/**
 * FR-3 … FR-7 / B2.2 — the scribe's AI steps against a scripted LLM.
 * Schema-validated output, one repair pass, no "[object Object]", dose kept
 * separate, prior-visit context in the prompt, idempotent speaker labels.
 */
import assert from 'node:assert/strict'
import {
  buildAnalysisUserMessage,
  extractJsonObject,
  generateAnalysis,
  labelSpeakers,
  normalizeAnalysis,
  OUTPUT_CONTRACT,
  scribeJsonSchema,
} from '../services/scribeAnalysis'
import { AiError } from '../services/ai/errors'
import { mockAnalysis, PRIOR_VISITS_MARKER } from '../services/ai/mock'
import type { CompletionRequest, LlmProvider } from '../services/ai/types'

/** An LLM that answers from a script and records every request. */
function scripted(...answers: string[]) {
  const requests: CompletionRequest[] = []
  const llm: LlmProvider = {
    describe: () => ({
      kind: 'test',
      preset: 'test',
      host: null,
      model: 'test-model',
      location: 'in-process',
    }),
    complete: (req) => {
      requests.push(req)
      const text = answers.shift()
      if (text === undefined) return Promise.reject(new Error('unexpected call'))
      return Promise.resolve({ text, model: 'test-model' })
    },
  }
  return { llm, requests }
}

const valid = JSON.stringify(mockAnalysis('TRANSCRIPT'))
const input = {
  basePrompt: 'Template prompt.',
  transcript: 'Provider: hi\nPatient: tired',
  priorDigest: null,
}

describe('generateAnalysis', () => {
  it('asks for the scribe schema and returns the validated draft', async () => {
    const { llm, requests } = scripted(valid)
    const { analysis, model } = await generateAnalysis(llm, input)
    assert.equal(model, 'test-model')
    assert.match(analysis.soap.assessment, /Fatigue, improving/)
    assert.deepEqual(analysis.orders, [
      { name: 'Vitamin D3', dose: '5000 IU', quantity: 1 },
      { name: 'Magnesium glycinate', dose: '400 mg', quantity: 2 },
    ])
    assert.equal(analysis.continuity, null)
    assert.ok(analysis.patientSummary.nextSteps)

    const [req] = requests
    assert.equal(req!.system, 'Template prompt.' + OUTPUT_CONTRACT)
    assert.equal(req!.jsonSchema?.name, 'scribe_analysis')
    assert.deepEqual(req!.jsonSchema?.schema, scribeJsonSchema())
    assert.match(req!.user, /^TRANSCRIPT:\nProvider: hi/)
    assert.ok(!req!.user.includes(PRIOR_VISITS_MARKER))
  })

  it('FR-7: the prior-visit digest goes into the prompt, and continuity comes back', async () => {
    const digest = '- 2026-09-01 · Assessment: Fatigue · Plan: Vitamin D3'
    const answer = JSON.stringify(mockAnalysis(`x ${PRIOR_VISITS_MARKER}`))
    const { llm, requests } = scripted(answer)
    const { analysis } = await generateAnalysis(llm, { ...input, priorDigest: digest })
    assert.ok(requests[0]!.user.includes(`${PRIOR_VISITS_MARKER} (most recent first`))
    assert.ok(requests[0]!.user.includes(digest))
    assert.match(analysis.continuity ?? '', /Since the last visit/)
  })

  it('accepts JSON wrapped in prose or a code fence', async () => {
    const { llm } = scripted('Here you go:\n```json\n' + valid + '\n```')
    const { analysis } = await generateAnalysis(llm, input)
    assert.match(analysis.soap.plan, /Recheck in six weeks/)
  })

  it('invalid output gets one repair pass on the same provider', async () => {
    const { llm, requests } = scripted('Sorry, the note is: patient is tired.', valid)
    const { analysis } = await generateAnalysis(llm, input)
    assert.equal(requests.length, 2)
    assert.match(requests[1]!.system, /You repair JSON/)
    assert.equal(requests[1]!.user, 'Sorry, the note is: patient is tired.')
    assert.ok(analysis.soap.subjective)
  })

  it('still invalid after the repair → ai_bad_output (no half-parsed note)', async () => {
    const { llm } = scripted('not json', '{"soap": {"subjective": {"nested": true}}}')
    await assert.rejects(
      generateAnalysis(llm, input),
      (e: unknown) => e instanceof AiError && e.code === 'ai_bad_output'
    )
  })
})

describe('normalizeAnalysis', () => {
  it('never produces "[object Object]": an object where text belongs is unusable', () => {
    assert.equal(
      normalizeAnalysis({
        soap: { subjective: { a: 1 }, objective: '', assessment: 'x', plan: '' },
      }),
      null
    )
  })

  it('an all-empty note is unusable', () => {
    assert.equal(
      normalizeAnalysis({ soap: { subjective: '', objective: '', assessment: '', plan: '' } }),
      null
    )
  })

  it('tolerates common deviations: top-level SOAP, list sections, missing parts', () => {
    const a = normalizeAnalysis({
      Subjective: ['Tired', 'Sleeps poorly'],
      objective: 'Alert',
      assessment: 'Fatigue',
      plan: 42,
      products: [{ product: 'Zinc', strength: '25 mg', qty: '2' }],
    })
    assert.ok(a)
    assert.equal(a.soap.subjective, 'Tired\nSleeps poorly')
    assert.equal(a.soap.plan, '42')
    assert.deepEqual(a.timeline, { symptoms: [], duration: null, assessment: null, plan: [] })
    assert.deepEqual(a.orders, [{ name: 'Zinc', dose: '25 mg', quantity: 2 }])
    assert.deepEqual(a.patientSummary, { diagnosis: '', treatmentPlan: '', nextSteps: '' })
    assert.equal(a.continuity, null)
  })

  it('bounds the size of every section', () => {
    const a = normalizeAnalysis({
      soap: { subjective: 'x'.repeat(50_000), objective: '', assessment: 'a', plan: '' },
    })
    assert.equal(a!.soap.subjective.length, 20_000)
  })
})

describe('helpers', () => {
  it('extractJsonObject takes the outermost object and ignores arrays', () => {
    assert.deepEqual(extractJsonObject('pre {"a":{"b":1}} post'), { a: { b: 1 } })
    assert.equal(extractJsonObject('[1,2]'), null)
    assert.equal(extractJsonObject('nothing here'), null)
  })

  it('the JSON schema is generated from the Zod shape, without $schema', () => {
    const schema = scribeJsonSchema()
    assert.equal(schema.$schema, undefined)
    assert.equal(schema.type, 'object')
    assert.deepEqual(schema.required, [
      'soap',
      'timeline',
      'orders',
      'continuity',
      'patientSummary',
    ])
  })

  it('buildAnalysisUserMessage adds the prior-visit section only when there is one', () => {
    assert.equal(buildAnalysisUserMessage('T', null), 'TRANSCRIPT:\nT')
    assert.ok(buildAnalysisUserMessage('T', 'D').endsWith('context for continuity only):\nD'))
  })
})

describe('labelSpeakers (FR-3)', () => {
  const raw = 'how are you feeling today i am tired all the time and i wake up at night a lot'

  it('labels a raw transcript', async () => {
    const labelled =
      'Provider: how are you feeling today\nPatient: i am tired all the time and i wake up at night a lot'
    const { llm } = scripted(labelled)
    assert.equal(await labelSpeakers(llm, raw), labelled)
  })

  it('is idempotent: an already-labelled transcript is not sent again (retry-safe)', async () => {
    const { llm, requests } = scripted()
    const already = 'Provider: hello there, how are you?\nPatient: fine thanks, a bit tired today.'
    assert.equal(await labelSpeakers(llm, already), already)
    assert.equal(requests.length, 0)
  })

  it('discards a "labelled" result that summarised instead of transcribing', async () => {
    const { llm } = scripted('Patient: tired.')
    assert.equal(await labelSpeakers(llm, raw), raw)
  })

  it('discards a result without speaker labels', async () => {
    const { llm } = scripted(raw.toUpperCase())
    assert.equal(await labelSpeakers(llm, raw), raw)
  })
})
