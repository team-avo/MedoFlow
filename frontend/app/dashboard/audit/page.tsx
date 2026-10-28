'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAuditLogs } from '@/lib/auditApi'
import { AppPageHeader, AppCard, AppCardContent, AppButton, AppTable } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

const LIMIT = 50

type AuditLog = {
  id: string
  createdAt: string
  performedBy: { name: string; email: string }
  entityType: string
  entityId: string
  action: string
  fieldChanged?: string | null
  newValue?: unknown
}

export default function AuditLogsPage() {
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', offset],
    queryFn: () => listAuditLogs({ limit: LIMIT, offset }),
  })

  const logs: AuditLog[] = (data?.logs as AuditLog[]) || []
  const total: number = data?.total || 0

  const handleNext = () => {
    if (offset + LIMIT < total) setOffset(offset + LIMIT)
  }
  const handlePrev = () => setOffset(Math.max(0, offset - LIMIT))

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Audit Logs"
        description="Review system activities and compliance events."
      />

      <AppCard>
        <AppCardContent className="p-0">
          {isLoading ? (
            <LoadingSkeleton variant="table" className="rounded-none border-0" />
          ) : (
            <AppTable<AuditLog>
              mobileCardMode
              data={logs}
              keyExtractor={(log) => log.id}
              emptyTitle="No audit events yet"
              emptyDescription="Changes made in the clinic will show up here for compliance review."
              columns={[
                {
                  key: 'timestamp',
                  header: 'Timestamp',
                  mobileLabel: 'When',
                  mobilePrimary: true,
                  render: (log) => (
                    <span className="whitespace-nowrap text-sm">
                      {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                    </span>
                  ),
                },
                {
                  key: 'user',
                  header: 'User',
                  render: (log) => (
                    <div>
                      <div className="text-sm font-medium">{log.performedBy.name}</div>
                      <div className="text-xs text-muted-foreground">{log.performedBy.email}</div>
                    </div>
                  ),
                },
                {
                  key: 'entity',
                  header: 'Entity',
                  render: (log) => (
                    <div>
                      <Badge variant="outline">{log.entityType}</Badge>
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {log.entityId}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'action',
                  header: 'Action',
                  render: (log) => <span className="text-sm font-semibold">{log.action}</span>,
                },
                {
                  key: 'changes',
                  header: 'Changes',
                  wrap: true,
                  mobileLabel: 'Change',
                  render: (log) => (
                    <div className="max-w-[300px] overflow-hidden text-ellipsis break-words text-xs">
                      {log.fieldChanged && (
                        <span className="mr-1 font-bold">{log.fieldChanged}:</span>
                      )}
                      {log.newValue ? JSON.stringify(log.newValue) : '-'}
                    </div>
                  ),
                },
              ]}
            />
          )}

          <div className="flex flex-col items-start justify-between gap-3 border-t p-4 sm:flex-row sm:items-center">
            <div className="text-sm text-muted-foreground">
              Showing {offset + 1} to {Math.min(offset + LIMIT, total)} of {total} events
            </div>
            <div className="flex gap-2">
              <AppButton variant="outline" size="sm" onClick={handlePrev} disabled={offset === 0}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
              </AppButton>
              <AppButton
                variant="outline"
                size="sm"
                onClick={handleNext}
                disabled={offset + LIMIT >= total}
              >
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </AppButton>
            </div>
          </div>
        </AppCardContent>
      </AppCard>
    </PageContainer>
  )
}
