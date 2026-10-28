'use client'

import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { getPackageOperationalSummary, getPackages } from '@/lib/packageApi'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

function formatMoney(value?: string | number | null) {
  return `$${Number(value ?? 0).toFixed(2)}`
}

export default function PackagesPage() {
  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['packages'],
    queryFn: () => getPackages(true),
  })

  const { data: summary } = useQuery({
    queryKey: ['package-operational-summary'],
    queryFn: getPackageOperationalSummary,
  })

  return (
    <PageContainer className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Packages</h1>
        <AppButton disabled title="Package catalog setup is managed by your account administrator.">
          <Plus className="mr-2 h-4 w-4" /> Add Package
        </AppButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppCard>
          <AppCardHeader>
            <AppCardTitle>Active Catalog</AppCardTitle>
          </AppCardHeader>
          <AppCardContent className="text-3xl font-semibold">
            {summary?.activeCatalogPackages ?? 0}
          </AppCardContent>
        </AppCard>
        <AppCard>
          <AppCardHeader>
            <AppCardTitle>Active Patient Packages</AppCardTitle>
          </AppCardHeader>
          <AppCardContent className="text-3xl font-semibold">
            {summary?.activePatientPackageCount ?? 0}
          </AppCardContent>
        </AppCard>
        <AppCard>
          <AppCardHeader>
            <AppCardTitle>Exhausted</AppCardTitle>
          </AppCardHeader>
          <AppCardContent className="text-3xl font-semibold text-amber-600">
            {summary?.exhaustedCount ?? 0}
          </AppCardContent>
        </AppCard>
        <AppCard>
          <AppCardHeader>
            <AppCardTitle>Expiring Soon</AppCardTitle>
          </AppCardHeader>
          <AppCardContent className="text-3xl font-semibold text-slate-700">
            {summary?.expiringSoonCount ?? 0}
          </AppCardContent>
        </AppCard>
      </div>

      <div className="text-sm text-slate-600">
        This view shows live package catalog and patient package activity. Catalog setup is managed
        by your account administrator.
      </div>

      {isLoading ? (
        <LoadingSkeleton variant="card" count={4} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <AppCard key={pkg.id}>
              <AppCardHeader>
                <div className="flex items-center justify-between gap-2">
                  <AppCardTitle>{pkg.name}</AppCardTitle>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      pkg.isActive
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {pkg.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </AppCardHeader>
              <AppCardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  {pkg.description || 'No description available.'}
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold">{formatMoney(pkg.price)}</span>
                    <span className="text-sm">Sessions: {pkg.totalSessions || 'Unlimited'}</span>
                  </div>
                  {pkg.expiresInDays ? (
                    <div className="text-xs text-muted-foreground">
                      Expires in {pkg.expiresInDays} days
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No catalog expiry</div>
                  )}
                </div>
              </AppCardContent>
            </AppCard>
          ))}
          {packages.length === 0 && (
            <div className="col-span-full py-10 text-center text-muted-foreground">
              No packages found. Add one to get started.
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}
