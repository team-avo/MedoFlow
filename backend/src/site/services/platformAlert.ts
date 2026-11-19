/**
 * Who hears about clinic-site problems the platform team must fix (a launch
 * that failed after its retries, the Pages domain limit): PLATFORM_REVIEW_EMAIL,
 * or every active platform admin (at most 20).
 */
import prisma from '../../config/prisma'
import { platformReviewRecipients } from '../../config/clinicReview'

export async function platformAlertRecipients(): Promise<string[]> {
  const configured = platformReviewRecipients()
  if (configured) return configured
  const admins = await prisma.user.findMany({
    where: { role: 'PLATFORM_ADMIN', isActive: true },
    select: { email: true },
    take: 20,
  })
  return admins.map((a) => a.email)
}
