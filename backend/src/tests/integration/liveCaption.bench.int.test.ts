/**
 * CTO-41 benchmark: the server-side cost of one live caption.
 *
 * Measures the full HTTP round-trip of POST /consultations/:id/live-transcript
 * against the in-process mock speech-to-text provider, and again with the mock
 * delayed, to show the fixed overhead (gate reads, multer, turn parsing) is
 * additive rather than multiplicative. Opt-in, CI skips it:
 *
 *   LIVE_CAPTION_BENCH=1 pnpm exec vitest run --config vitest.integration.config.ts \
 *     src/tests/integration/liveCaption.bench.int.test.ts
 *
 * IMPORTANT: this CANNOT measure either agreed headline metric. First-word
 * delay needs the moment recording started and round-trip needs the moment the
 * caption reached the screen; both clocks live in the browser
 * (frontend/hooks/useLiveTranscription.ts, which reports p50/p95 on screen).
 * This benchmark only guards against a server-side regression.
 *
 * Synthetic data only.
 */
import crypto from 'crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { mockScribeControl } from '../../services/ai/mock'

const RUNS = 40
const SEGMENT_BYTES = 48 * 1024 // a ~2-3 s opus segment is ~50-100 KB

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!

describe.skipIf(!process.env.LIVE_CAPTION_BENCH)(
  'CTO-41 benchmark: live caption round-trip',
  () => {
    let server: TestServer
    let C: ClinicFixture
    let token = ''
    let sessionId = ''

    beforeAll(async () => {
      server = await startServer()
      C = await createClinicFixture('caption-bench')
      token = (await login(server.url, C.users.provider.email)).accessToken

      const started = await api(server.url, `/appointments/${C.appointmentId}/consultation/start`, {
        token,
        body: {},
      })
      expect(started.status, JSON.stringify(started.body)).toBe(201)
      sessionId = started.body.data.session.id
      await adminDb.consultationSession.update({
        where: { id: sessionId },
        data: { consentStatus: 'GRANTED', recordingStatus: 'RECORDING' },
      })
    }, 120_000)

    afterAll(() => server?.close())

    it('the caption path adds bounded overhead over any authenticated request', async () => {
      const postSegment = async (seq: number) => {
        const form = new FormData()
        form.append('segment', String(seq))
        form.append(
          'audio',
          new Blob([crypto.randomBytes(SEGMENT_BYTES)], { type: 'audio/webm' }),
          'segment.webm'
        )
        const res = await fetch(`${server.url}/consultations/${sessionId}/live-transcript`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'x-medoflow-client': 'web' },
          body: form,
        })
        expect(res.status).toBe(200)
        await res.json()
      }

      const time = async (fn: (i: number) => Promise<unknown>) => {
        const samples: number[] = []
        await fn(0) // warm-up, not measured
        for (let i = 0; i < RUNS; i += 1) {
          const t0 = performance.now()
          await fn(i)
          samples.push(performance.now() - t0)
        }
        return samples.sort((a, b) => a - b)
      }

      // Baseline: an authenticated, provider-only request on the same box.
      const baseline = await time(async () => {
        const res = await api(server.url, '/ai-scribe/capabilities', { token })
        expect(res.status).toBe(200)
      })

      mockScribeControl.reset()
      const live = await time((i) => postSegment(i))

      // The same path with a realistic provider delay: overhead should be additive.
      mockScribeControl.latencyMs = 400
      const delayed = await time((i) => postSegment(i))
      mockScribeControl.reset()

      const row = (name: string, s: number[]) =>
        `${name.padEnd(22)} p50 ${percentile(s, 50).toFixed(1).padStart(8)} ms   p95 ${percentile(
          s,
          95
        )
          .toFixed(1)
          .padStart(8)} ms`
      // eslint-disable-next-line no-console
      console.log(
        [
          `CTO-41 benchmark: ${RUNS} runs each, ${Math.round(SEGMENT_BYTES / 1024)} KB segments, mock STT`,
          row('authenticated GET', baseline),
          row('live caption', live),
          row('live caption +400 ms', delayed),
          'Headline first-word and round-trip p50/p95 are measured in the browser; see the walkthrough.',
        ].join('\n')
      )

      // Relative, like the availability benchmark: a hard ms budget is CI noise.
      expect(percentile(live, 95)).toBeLessThan(percentile(baseline, 95) + 250)
      // The provider's own latency must pass through, not be multiplied.
      expect(percentile(delayed, 95)).toBeLessThan(percentile(live, 95) + 400 + 250)
    }, 600_000)
  }
)
