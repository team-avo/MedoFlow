'use client'

/**
 * Where the clinic's address stands on Cloudflare Pages (CTO-26): going live
 * after Publish, live, or failed with a reason and a Retry. Hidden when
 * Cloudflare isn't configured on this server (local development).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { apiErrorOf } from '@/lib/apiError'
import { useAppToast } from '@/hooks/useAppToast'

interface Launch {
  status: 'PENDING' | 'LIVE' | 'FAILED' | 'REMOVED' | 'NOT_CONFIGURED' | 'NONE'
  url?: string | null
  lastError?: string | null
  attempts?: number
}

export function LaunchStatus() {
  const toast = useAppToast()
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['site', 'launch'],
    queryFn: async () =>
      (await api.get<{ data?: Launch }>('/site/launch')).data.data ?? { status: 'NONE' as const },
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 3_000 : false),
  })
  const retry = useMutation({
    mutationFn: () => api.post('/site/launch/retry', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['site', 'launch'] }),
    onError: (err) => toast.error(apiErrorOf(err).message),
  })
  if (
    !data ||
    data.status === 'NOT_CONFIGURED' ||
    data.status === 'NONE' ||
    data.status === 'REMOVED'
  )
    return null
  return (
    <div
      role="status"
      data-testid="site-launch"
      className={
        data.status === 'FAILED'
          ? 'rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900'
          : data.status === 'LIVE'
            ? 'rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900'
            : 'rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700'
      }
    >
      {data.status === 'PENDING' && 'Putting your address live… this usually takes under a minute.'}
      {data.status === 'LIVE' && (
        <>
          Your address is live:{' '}
          <a
            href={data.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline"
          >
            {data.url?.replace(/^https?:\/\//, '')}
          </a>
        </>
      )}
      {data.status === 'FAILED' && (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Your address didn&apos;t go live: {data.lastError ?? 'unknown error'}. Our team has been
            told.
          </span>
          <button
            type="button"
            onClick={() => retry.mutate()}
            disabled={retry.isPending}
            className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-rose-900 ring-1 ring-rose-200 hover:bg-rose-100"
          >
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  )
}
