import * as paymentService from '../services/paymentService'
import * as waitlistService from '../services/waitlistService'
import * as slotHoldService from '../services/slotHoldService'
import * as notificationService from '../services/notificationService'
import * as breakGlassService from '../services/breakGlassService'
import { purgeExpiredAuditLogs } from '../services/auditService'
import { logError } from '../utils/errorLogger'
import { withTenantBypass } from '../config/tenantContext'

const INTERVAL_MS = 5 * 60 * 1000
const DAILY_MS = 24 * 60 * 60 * 1000

/**
 * Cron iterates across tenants by design (clean up expired holds across the
 * whole platform). Wrap the whole tick in a named bypass so the Prisma
 * tenant guard permits the cross-tenant queries these services issue.
 *
 * Each individual service still operates on rows it owns (filters by
 * status/expiresAt, not clinicId), which is the correct semantics for a
 * janitorial sweep. The bypass label `cron:expiry-sweep` is the audit
 * trail for these queries.
 */
export const startCronJobs = (): void => {
  setInterval(() => {
    withTenantBypass('cron:expiry-sweep', async () => {
      try {
        const [paymentCount, waitlistCount, slotHoldCount, reminderCount] = await Promise.all([
          paymentService.releaseExpiredPendingPayments(),
          waitlistService.expireWaitlistOffers(),
          slotHoldService.expireSlotHolds(),
          notificationService.sendAppointmentReminders(),
          breakGlassService.expireBreakGlassGrants(),
        ])
        if (paymentCount > 0 || waitlistCount > 0 || slotHoldCount > 0 || reminderCount > 0) {
          process.stderr.write(
            `[Cron] Expired: ${paymentCount} payments, ${waitlistCount} waitlist offers, ${slotHoldCount} slot holds. Sent: ${reminderCount} reminders.\n`
          )
        }
      } catch (err) {
        logError(err, { job: 'payment-waitlist-slot-hold-reminder-expiry' })
      }
    })
  }, INTERVAL_MS)

  // Audit retention (B0.3.6): delete rows older than AUDIT_RETENTION_YEARS
  // (≥ 6). Runs over AUDIT_PURGE_DATABASE_URL; skipped when unset.
  setInterval(() => {
    purgeExpiredAuditLogs()
      .then((deleted) => {
        if (deleted)
          process.stderr.write(`[Cron] Audit retention purge removed ${deleted} rows.
`)
      })
      .catch((err) => logError(err, { job: 'audit-retention-purge' }))
  }, DAILY_MS)
}
