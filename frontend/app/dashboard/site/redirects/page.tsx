'use client'

/** URL redirects (F8.5): automatic ones from renamed pages, manual ones, CSV import. */
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Trash2, Upload } from 'lucide-react'
import { siteApi, siteErrorMessage } from '@/lib/site/siteApi'
import { AppBadge, AppButton, AppModal } from '@/components/ui-system'
import { inputCls, Label } from '@/components/site/builder/fields'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

const KEY = ['site', 'redirects'] as const

export default function SiteRedirectsPage() {
  const qc = useQueryClient()
  const { data: items = [], isLoading } = useQuery({
    queryKey: KEY,
    queryFn: siteApi.listRedirects,
  })
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [csvOpen, setCsvOpen] = React.useState(false)
  const [csv, setCsv] = React.useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY })

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await siteApi.createRedirect(from, to)
      setFrom('')
      setTo('')
      refresh()
      toast.success('Redirect added')
    } catch (err) {
      toast.error(siteErrorMessage(err))
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Redirects</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Keep old links and search rankings working. Renaming a page, service, team member or
              product adds a redirect automatically. Moving from another website? Import its old
              addresses.
            </p>
          </div>
          <AppButton variant="outline" onClick={() => setCsvOpen(true)}>
            <Upload className="mr-1 h-4 w-4" /> Import CSV
          </AppButton>
        </div>
        <form
          onSubmit={(e) => void add(e)}
          className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end"
        >
          <div>
            <Label htmlFor="rd-from">Old address</Label>
            <input
              id="rd-from"
              className={inputCls}
              placeholder="/our-team.html"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <ArrowRight className="mx-auto mb-2.5 hidden h-4 w-4 text-slate-400 sm:block" />
          <div>
            <Label htmlFor="rd-to">New address</Label>
            <input
              id="rd-to"
              className={inputCls}
              placeholder="/team"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <AppButton type="submit" disabled={!from || !to}>
            Add
          </AppButton>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        {isLoading ? (
          <LoadingSkeleton variant="row" count={3} className="p-6" />
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No redirects yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <code className="rounded bg-slate-100 px-1.5 py-0.5">{r.fromPath}</code>
                <ArrowRight className="h-4 w-4 text-slate-400" />
                <code className="rounded bg-slate-100 px-1.5 py-0.5">{r.toPath}</code>
                <span className="text-xs text-slate-500">{r.code}</span>
                {r.auto && <AppBadge variant="neutral">Automatic</AppBadge>}
                <button
                  type="button"
                  aria-label={`Delete redirect from ${r.fromPath}`}
                  className="ml-auto rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={async () => {
                    try {
                      await siteApi.deleteRedirect(r.id)
                      refresh()
                    } catch (err) {
                      toast.error(siteErrorMessage(err))
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AppModal
        open={csvOpen}
        onOpenChange={setCsvOpen}
        title="Import redirects"
        description="One per line: old address, new address. Up to 200 lines."
        primaryAction={{
          label: 'Import',
          disabled: !csv.trim(),
          onClick: async () => {
            try {
              const results = await siteApi.importRedirects(csv)
              const failed = results.filter((x) => !x.ok)
              toast[failed.length ? 'warning' : 'success'](
                `${results.length - failed.length} imported${failed.length ? `, ${failed.length} skipped (line ${failed.map((f) => f.line).join(', ')})` : ''}`
              )
              setCsvOpen(false)
              setCsv('')
              refresh()
            } catch (err) {
              toast.error(siteErrorMessage(err))
            }
          },
        }}
        secondaryAction={{ label: 'Cancel', onClick: () => setCsvOpen(false) }}
      >
        <textarea
          aria-label="CSV"
          className={`${inputCls} font-mono`}
          rows={8}
          value={csv}
          placeholder={'from,to\n/about.html,/about\n/staff.php,/team'}
          onChange={(e) => setCsv(e.target.value)}
        />
      </AppModal>
    </div>
  )
}
