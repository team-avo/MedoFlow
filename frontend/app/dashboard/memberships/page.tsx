'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { AppButton } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { useAuth } from '@/contexts/AuthContext'
import {
  cancelMembershipAtPeriodEnd,
  getMemberships,
  getMembershipOperationalSummary,
  getMyMembershipSubscriptions,
  purchaseMembership,
  type MembershipCatalogItem,
} from '@/lib/membershipApi'
import { StripePaymentForm } from '@/components/StripePaymentForm'
import { toast } from 'sonner'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'
)

function formatMoney(value?: string | number | null) {
  return `$${Number(value ?? 0).toFixed(2)}`
}

export default function MembershipsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)
  const [selectedMembership, setSelectedMembership] = useState<MembershipCatalogItem | null>(null)

  const isPatient = user?.role === 'PATIENT'

  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ['memberships'],
    queryFn: getMemberships,
  })

  const { data: subscriptions = [] } = useQuery({
    queryKey: ['membership-subscriptions'],
    queryFn: getMyMembershipSubscriptions,
    enabled: isPatient,
  })

  const { data: operationalSummary } = useQuery({
    queryKey: ['membership-operational-summary'],
    queryFn: getMembershipOperationalSummary,
    enabled: !isPatient,
  })

  const activeSubscription = useMemo(
    () =>
      subscriptions.find((subscription) =>
        ['ACTIVE', 'TRIALING', 'PAST_DUE', 'INCOMPLETE'].includes(subscription.status)
      ) ?? null,
    [subscriptions]
  )

  const purchaseMutation = useMutation({
    mutationFn: (membershipId: string) => purchaseMembership(membershipId),
    onSuccess: (result, membershipId) => {
      const membership = memberships.find((item) => item.id === membershipId) ?? null
      setSelectedMembership(membership)
      setCheckoutClientSecret(result.clientSecret)
      queryClient.invalidateQueries({ queryKey: ['membership-subscriptions'] })
      if (!result.clientSecret) {
        toast.success('Membership subscription is already active.')
      }
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || 'Failed to start membership checkout')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (subscriptionId: string) => cancelMembershipAtPeriodEnd(subscriptionId),
    onSuccess: () => {
      toast.success('Membership will cancel at period end')
      queryClient.invalidateQueries({ queryKey: ['membership-subscriptions'] })
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Failed to schedule cancellation'),
  })

  const renderAdminCatalog = () => (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Memberships</h1>
        <AppButton
          disabled
          title="Membership catalog setup is managed by your account administrator."
        >
          <Plus className="mr-2 h-4 w-4" /> Add Membership
        </AppButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Active</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {operationalSummary?.activeCount ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Past Due</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-amber-600">
            {operationalSummary?.pastDueCount ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending Activation</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-slate-700">
            {operationalSummary?.incompleteCount ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cancel At Period End</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-slate-700">
            {operationalSummary?.cancelAtPeriodEndCount ?? 0}
          </CardContent>
        </Card>
      </div>

      <div className="text-sm text-slate-600">
        This view shows live subscription activity. Membership catalog setup is managed by your
        account administrator.
      </div>

      {isLoading ? (
        <LoadingSkeleton variant="card" count={4} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {memberships.map((membership) => (
              <Card key={membership.id}>
                <CardHeader>
                  <CardTitle>{membership.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {membership.description || 'No description available.'}
                  </p>
                  <div className="font-semibold text-lg">
                    {formatMoney(membership.monthlyPrice)} /{' '}
                    {membership.billingPeriod.toLowerCase()}
                  </div>
                  <div className="text-sm text-slate-600">
                    Service discount: {Number(membership.serviceDiscountPercent ?? 0).toFixed(0)}%
                  </div>
                </CardContent>
              </Card>
            ))}
            {memberships.length === 0 && (
              <div className="col-span-full py-10 text-center text-muted-foreground">
                No memberships found. Add one to get started.
              </div>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Subscription Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(operationalSummary?.recentSubscriptions ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No subscription activity yet.</div>
              ) : (
                operationalSummary!.recentSubscriptions.map((subscription) => (
                  <div
                    key={subscription.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <div className="font-medium">{subscription.patient?.name ?? 'Patient'}</div>
                      <div className="text-sm text-slate-600">
                        {subscription.membership.name} • {subscription.status}
                      </div>
                    </div>
                    <div className="text-sm text-slate-600">
                      Ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )

  const renderPatientMemberships = () => (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Memberships</h1>
        <p className="text-sm text-muted-foreground">
          One active membership per clinic is supported. Membership discounts apply to service
          bookings when no package session is used.
        </p>
      </div>

      {activeSubscription && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Current Membership</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="font-semibold">{activeSubscription.membership.name}</div>
            <div className="text-sm text-slate-700">Status: {activeSubscription.status}</div>
            <div className="text-sm text-slate-700">
              Discount:{' '}
              {Number(activeSubscription.membership.serviceDiscountPercent ?? 0).toFixed(0)}%
            </div>
            <div className="text-sm text-slate-700">
              Current period ends:{' '}
              {new Date(activeSubscription.currentPeriodEnd).toLocaleDateString()}
            </div>
            <div className="text-sm text-slate-700">
              Cancel at period end: {activeSubscription.cancelAtPeriodEnd ? 'Yes' : 'No'}
            </div>
            {!activeSubscription.cancelAtPeriodEnd &&
              ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(activeSubscription.status) && (
                <AppButton
                  variant="outline"
                  onClick={() => cancelMutation.mutate(activeSubscription.id)}
                  disabled={cancelMutation.isPending}
                >
                  Cancel at period end
                </AppButton>
              )}
          </CardContent>
        </Card>
      )}

      {checkoutClientSecret && selectedMembership && (
        <Card>
          <CardHeader>
            <CardTitle>Complete Membership Checkout</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 text-sm text-slate-700">
              {selectedMembership.name} • {formatMoney(selectedMembership.monthlyPrice)} /{' '}
              {selectedMembership.billingPeriod.toLowerCase()}
            </div>
            <Elements stripe={stripePromise} options={{ clientSecret: checkoutClientSecret }}>
              <StripePaymentForm
                clientSecret={checkoutClientSecret}
                buttonLabel={`Start ${selectedMembership.name}`}
                onSuccess={() => {
                  toast.success('Membership activated')
                  setCheckoutClientSecret(null)
                  setSelectedMembership(null)
                  queryClient.invalidateQueries({ queryKey: ['membership-subscriptions'] })
                }}
              />
            </Elements>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {memberships.map((membership) => {
          const blockedByOtherMembership =
            !!activeSubscription && activeSubscription.membership.id !== membership.id
          const isCurrent = activeSubscription?.membership.id === membership.id

          return (
            <Card key={membership.id}>
              <CardHeader>
                <CardTitle>{membership.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {membership.description || 'No description available.'}
                </p>
                <div className="font-semibold text-lg">
                  {formatMoney(membership.monthlyPrice)} / {membership.billingPeriod.toLowerCase()}
                </div>
                <div className="text-sm text-slate-600">
                  Service discount: {Number(membership.serviceDiscountPercent ?? 0).toFixed(0)}%
                </div>
                <AppButton
                  className="w-full"
                  disabled={purchaseMutation.isPending || blockedByOtherMembership || isCurrent}
                  onClick={() => purchaseMutation.mutate(membership.id)}
                >
                  {isCurrent
                    ? 'Current membership'
                    : blockedByOtherMembership
                      ? 'Another membership is active'
                      : 'Start membership'}
                </AppButton>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )

  return (
    <PageContainer className="space-y-8">
      {isPatient ? renderPatientMemberships() : renderAdminCatalog()}
    </PageContainer>
  )
}
