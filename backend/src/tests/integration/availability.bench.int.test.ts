/**
 * B1.3 benchmark: p50/p95 latency of getAvailableDatesInRange before (the
 * pre-B1.3 N×M reference) and after (set-based), on a clinic with several
 * providers and a busy calendar. Opt-in — CI skips it:
 *
 *   SCHEDULING_BENCH=1 pnpm exec vitest run --config vitest.integration.config.ts \
 *     src/tests/integration/availability.bench.int.test.ts
 *
 * Prints a table and asserts the set-based p95 is lower. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { adminDb } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { legacyGetAvailableDatesInRange } from './legacyAvailability'
import * as availabilityService from '../../services/availabilityService'
import { withTenantBypass } from '../../config/tenantContext'

const PROVIDERS = 6
const WINDOW_DAYS = 60
const RUNS = 25

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!

describe.skipIf(!process.env.SCHEDULING_BENCH)('B1.3 benchmark — getAvailableDatesInRange', () => {
  let C: ClinicFixture

  beforeAll(async () => {
    C = await createClinicFixture('sched-bench')
    const today = DateTime.utc().startOf('day')
    const providerIds = [C.providerId]
    for (let i = 1; i < PROVIDERS; i++) {
      const user = await adminDb.user.create({
        data: {
          clinicId: C.clinicId,
          name: `Synthetic Bench ${i}`,
          email: `bench${i}.${Date.now()}@example.test`,
          password: 'x',
          role: 'PROVIDER',
        },
      })
      const p = await adminDb.provider.create({
        data: { clinicId: C.clinicId, userId: user.id, firstName: 'Bench', lastName: `${i}` },
      })
      await adminDb.providerService.create({ data: { providerId: p.id, serviceId: C.serviceId } })
      await adminDb.providerLocationAssignment.create({
        data: { providerId: p.id, locationId: C.locationId },
      })
      await adminDb.providerAvailability.createMany({
        data: [1, 2, 3, 4, 5].map((weekday) => ({
          providerId: p.id,
          locationId: C.locationId,
          weekday,
          startTime: '09:00',
          endTime: '17:00',
        })),
      })
      providerIds.push(p.id)
    }
    // Busy calendar: every provider fully booked on weekdays (16 × 30 min),
    // so the old loop has to try every provider on every day.
    const rows = []
    for (const providerId of providerIds.slice(1)) {
      for (let d = 1; d <= WINDOW_DAYS; d++) {
        const day = today.plus({ days: d })
        if (day.weekday > 5) continue
        for (let slot = 0; slot < 16; slot++) {
          const start = day.set({ hour: 9 }).plus({ minutes: 30 * slot })
          rows.push({
            clinicId: C.clinicId,
            providerId,
            serviceId: C.serviceId,
            patientId: C.users.patient.id,
            startTime: start.toJSDate(),
            endTime: start.plus({ minutes: 30 }).toJSDate(),
            priceAtBooking: 100,
          })
        }
      }
    }
    await adminDb.appointment.createMany({ data: rows })
    // The fixture provider (open 24/7) is removed from the service so only
    // the busy providers count: the worst case for the per-day loop.
    await adminDb.providerService.deleteMany({
      where: { providerId: C.providerId, serviceId: C.serviceId },
    })
  }, 120_000)

  it('set-based p95 is lower than the N×M p95', async () => {
    const params = {
      clinicId: C.clinicId,
      serviceId: C.serviceId,
      startDate: DateTime.utc().plus({ days: 1 }).toISODate(),
      endDate: DateTime.utc().plus({ days: WINDOW_DAYS }).toISODate(),
    }
    const time = async (fn: () => Promise<unknown>) => {
      const samples: number[] = []
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now()
        await withTenantBypass('scheduling-bench', fn)
        samples.push(performance.now() - t0)
      }
      return samples.sort((a, b) => a - b)
    }
    // Same answer first, then timings (one warm-up run each).
    const [legacyDates, currentDates] = await withTenantBypass('scheduling-bench', () =>
      Promise.all([
        legacyGetAvailableDatesInRange(params),
        availabilityService.getAvailableDatesInRange(params),
      ])
    )
    expect(currentDates).toEqual(legacyDates)

    const legacy = await time(() => legacyGetAvailableDatesInRange(params))
    const current = await time(() => availabilityService.getAvailableDatesInRange(params))
    const row = (name: string, s: number[]) =>
      `${name.padEnd(12)} p50 ${percentile(s, 50).toFixed(1).padStart(8)} ms   p95 ${percentile(s, 95).toFixed(1).padStart(8)} ms`
    // eslint-disable-next-line no-console
    console.log(
      [
        `B1.3 benchmark: ${PROVIDERS - 1} busy providers, ${WINDOW_DAYS}-day window, ${RUNS} runs each`,
        row('N×M (old)', legacy),
        row('set-based', current),
      ].join('\n')
    )
    expect(percentile(current, 95)).toBeLessThan(percentile(legacy, 95))
  }, 600_000)
})
