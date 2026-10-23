'use client'

/**
 * Website enquiries (F8.5). Messages can contain health information: they
 * are opened one at a time (each read is audited) and never cached.
 */
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, Inbox, Mail, MailOpen, Phone } from 'lucide-react'
import { siteApi, siteErrorMessage, type SiteLeadSummary } from '@/lib/site/siteApi'
import { AppBadge, AppButton } from '@/components/ui-system'
import { cn } from '@/lib/utils'

type Filter = 'inbox' | 'ARCHIVED'

export default function SiteLeadsPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = React.useState<Filter>('inbox')
  const { data, isLoading, error } = useQuery({
    queryKey: ['site', 'leads', filter],
    queryFn: () => siteApi.listLeads(filter === 'ARCHIVED' ? 'ARCHIVED' : undefined),
  })
  const [openId, setOpenId] = React.useState<string | null>(null)
  const { data: lead, isFetching } = useQuery({
    queryKey: ['site', 'lead', openId],
    queryFn: () => siteApi.readLead(openId!),
    enabled: !!openId,
    gcTime: 0,
    staleTime: 0,
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['site', 'leads'] })

  React.useEffect(() => {
    if (lead) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh the unread count after opening
  }, [lead?.id])

  const setStatus = async (l: SiteLeadSummary, status: 'NEW' | 'READ' | 'ARCHIVED') => {
    try {
      await siteApi.setLeadStatus(l.id, status)
      if (status === 'ARCHIVED') setOpenId(null)
      refresh()
    } catch (e) {
      toast.error(siteErrorMessage(e))
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h1 className="font-semibold text-slate-900">
            Enquiries{' '}
            {data?.unread ? <AppBadge variant="accent">{data.unread} new</AppBadge> : null}
          </h1>
          <div className="flex gap-1">
            {(['inbox', 'ARCHIVED'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium',
                  filter === f ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                {f === 'inbox' ? 'Inbox' : 'Archived'}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600">{siteErrorMessage(error)}</p>
        ) : !data?.items.length ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-500">
            <Inbox className="h-6 w-6 text-slate-300" />
            Messages from your website’s contact form arrive here.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(l.id)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50',
                    openId === l.id && 'bg-indigo-50/60'
                  )}
                  data-testid="lead-row"
                >
                  {l.status === 'NEW' ? (
                    <Mail className="mt-0.5 h-4 w-4 text-indigo-600" />
                  ) : (
                    <MailOpen className="mt-0.5 h-4 w-4 text-slate-400" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm',
                        l.status === 'NEW' ? 'font-semibold text-slate-900' : 'text-slate-700'
                      )}
                    >
                      {l.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{l.email}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(l.createdAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        {!openId ? (
          <p className="text-sm text-slate-500">
            Select an enquiry to read it. Each time a message is opened it is recorded in the audit
            log.
          </p>
        ) : isFetching && !lead ? (
          <p className="text-sm text-slate-500">Opening…</p>
        ) : lead ? (
          <article>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{lead.name}</h2>
                <p className="mt-1 flex flex-wrap gap-4 text-sm text-slate-600">
                  <a
                    href={`mailto:${lead.email}`}
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    <Mail className="h-4 w-4" /> {lead.email}
                  </a>
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Phone className="h-4 w-4" /> {lead.phone}
                    </a>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(lead.createdAt).toLocaleString()}
                  {lead.sourcePath ? ` · from ${lead.sourcePath}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <AppButton size="sm" variant="outline" onClick={() => void setStatus(lead, 'NEW')}>
                  Mark unread
                </AppButton>
                {lead.status !== 'ARCHIVED' && (
                  <AppButton
                    size="sm"
                    variant="outline"
                    onClick={() => void setStatus(lead, 'ARCHIVED')}
                  >
                    <Archive className="mr-1 h-4 w-4" /> Archive
                  </AppButton>
                )}
              </div>
            </div>
            <div
              className="mt-5 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-800"
              data-testid="lead-message"
            >
              {lead.message}
            </div>
          </article>
        ) : null}
      </section>
    </div>
  )
}
