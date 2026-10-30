/**
 * Component 2 client helpers: polling backoff (FR-11), provenance label
 * (FR-15), and the API error helper that shows the server's reason instead
 * of "Request failed with status code 503".
 */
import { describe, expect, it } from 'vitest'
import { nextPollDelay, POLL_MAX_MS, POLL_START_MS } from '@/hooks/useScribeSession'
import { provenanceLabel } from '@/lib/aiScribeApi'
import { apiErrorOf } from '@/lib/apiError'
import { apiErrorOf as fromRxCart } from '@/lib/rxCartApi'

describe('polling backoff', () => {
  it('grows by half from 3 s and caps at 10 s', () => {
    const seq = [POLL_START_MS]
    for (let i = 0; i < 6; i += 1) seq.push(nextPollDelay(seq[seq.length - 1]!))
    expect(seq).toEqual([3000, 4500, 6750, 10000, 10000, 10000, 10000])
    expect(Math.max(...seq)).toBe(POLL_MAX_MS)
  })
})

describe('provenanceLabel', () => {
  it('names the model and the vendor preset', () => {
    expect(
      provenanceLabel({
        aiModel: 'gpt-4o-mini',
        aiProvider: 'openai-compatible:openai@api.openai.com',
      })
    ).toBe('Drafted by gpt-4o-mini · openai')
    expect(
      provenanceLabel({ aiModel: 'llama3.1:8b', aiProvider: 'openai-compatible:ollama@127.0.0.1' })
    ).toBe('Drafted by llama3.1:8b · ollama')
    expect(provenanceLabel({ aiModel: 'mock-scribe-1', aiProvider: 'mock:mock' })).toBe(
      'Drafted by mock-scribe-1'
    )
    expect(provenanceLabel({ aiModel: 'demo-simulation', aiProvider: 'demo' })).toBe(
      'Demo conversation (synthetic)'
    )
    expect(provenanceLabel({ aiModel: null, aiProvider: null })).toBeNull()
  })
})

describe('apiErrorOf', () => {
  it("shows the server's message for a 503, not axios's", () => {
    const err = {
      message: 'Request failed with status code 503',
      response: {
        status: 503,
        data: {
          success: false,
          message: 'The AI scribe is not configured on this server.',
          code: 'ai_not_configured',
        },
      },
    }
    expect(apiErrorOf(err)).toEqual({
      status: 503,
      code: 'ai_not_configured',
      message: 'The AI scribe is not configured on this server.',
    })
  })

  it('falls back to a generic text (network error, no body)', () => {
    expect(apiErrorOf(new Error('Network Error')).message).toBe(
      'Something went wrong. Please try again.'
    )
  })

  it('is the same helper the cart uses (moved, not duplicated)', () => {
    expect(fromRxCart).toBe(apiErrorOf)
  })
})
