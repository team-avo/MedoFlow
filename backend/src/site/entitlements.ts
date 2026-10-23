/**
 * What a clinic's plan allows on its website (B8.7). There is no platform
 * entitlements engine yet (Component 12, B12); until there is, this is the
 * single place site features are gated, so B12 can absorb it in one move.
 */
import type { TenantPlan } from '@prisma/client'

export interface SiteEntitlements {
  /** Maximum pages, including HOME/SERVICES/TEAM/CONTACT/LEGAL. */
  maxPages: number
  /** Own domains a clinic can connect (subdomain is always included). */
  maxCustomDomains: number
  /** May the "Powered by MedoFlow" footer badge be hidden? */
  canRemoveBadge: boolean
  /** Uploaded images. */
  maxAssets: number
}

export const SITE_ENTITLEMENTS: Readonly<Record<TenantPlan, SiteEntitlements>> = {
  FREE: { maxPages: 8, maxCustomDomains: 0, canRemoveBadge: false, maxAssets: 40 },
  STARTER: { maxPages: 20, maxCustomDomains: 1, canRemoveBadge: false, maxAssets: 200 },
  GROWTH: { maxPages: 50, maxCustomDomains: 3, canRemoveBadge: true, maxAssets: 1000 },
  ENTERPRISE: { maxPages: 200, maxCustomDomains: 20, canRemoveBadge: true, maxAssets: 5000 },
}

export function siteEntitlements(plan: TenantPlan | null | undefined): SiteEntitlements {
  return SITE_ENTITLEMENTS[plan ?? 'FREE'] ?? SITE_ENTITLEMENTS.FREE
}
