'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPatientFiles,
  getMyFiles,
  uploadPatientFile,
  deletePatientFile,
  downloadPatientFile,
  downloadMyFile,
  type PatientFile,
} from '@/lib/fileApi'
import { useAppToast } from '@/hooks/useAppToast'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const PREVIEW_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']

function FilePreview({
  file,
  clinicId,
  asPatient = false,
}: {
  file: PatientFile
  clinicId?: string
  asPatient?: boolean
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const canPreview = PREVIEW_MIMES.some(
    (m) =>
      file.mimeType.toLowerCase() === m ||
      file.mimeType.toLowerCase().startsWith(m.split('/')[0] + '/')
  )

  const openPreview = async () => {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const params = clinicId ? `?clinicId=${clinicId}` : ''
    const path = asPatient
      ? `/api/v1/files/patient/me/${file.id}/download`
      : `/api/v1/files/${file.id}/download`
    const url = `${base}${path}${params}`
    const token =
      typeof window !== 'undefined' ? (await import('@/lib/api')).getAccessToken() : null
    const res = await fetch(url, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return
    const blob = await res.blob()
    setPreviewUrl(URL.createObjectURL(blob))
    setPreviewOpen(true)
  }

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewOpen(false)
  }

  if (!canPreview) return null

  const isImage = file.mimeType.toLowerCase().startsWith('image/')
  const isPdf = file.mimeType.toLowerCase().includes('pdf')

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        className="text-xs text-primary-600 hover:text-primary-700"
      >
        Preview
      </button>
      {previewOpen && previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={closePreview}
        >
          <div
            className="max-h-[90vh] max-w-[90vw] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL; must not be proxied/cached by the image optimiser
              <img
                src={previewUrl}
                alt={file.originalName}
                className="max-h-[90vh] object-contain"
              />
            )}
            {isPdf && (
              <iframe src={previewUrl} title={file.originalName} className="h-[90vh] w-[90vw]" />
            )}
          </div>
        </div>
      )}
    </>
  )
}

export function PatientFilesSection({
  patientId,
  clinicId,
  canDelete = false,
  canUpload = true,
  asPatient = false,
}: {
  patientId: string
  clinicId?: string
  canDelete?: boolean
  canUpload?: boolean
  /** When true, uses /patient/me endpoints for patient self-access */
  asPatient?: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useAppToast()
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files', asPatient ? 'me' : 'patient', patientId, clinicId],
    queryFn: () => (asPatient ? getMyFiles(clinicId) : getPatientFiles(patientId, clinicId)),
    enabled: !!patientId || asPatient,
  })

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => deletePatientFile(fileId, clinicId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', 'patient', patientId] })
      queryClient.invalidateQueries({ queryKey: ['files', 'me'] })
    },
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !clinicId) return
    setUploading(true)
    try {
      await uploadPatientFile(file, { patientId, clinicId })
      queryClient.invalidateQueries({ queryKey: ['files', 'patient', patientId] })
      queryClient.invalidateQueries({ queryKey: ['files', 'me'] })
      toast.success('File uploaded')
    } catch {
      toast.error('Failed to upload file')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const allTags = Array.from(
    new Set(files.flatMap((f) => (Array.isArray(f.tags) ? f.tags : f.tags ? [String(f.tags)] : [])))
  ).filter(Boolean) as string[]

  const filteredFiles = tagFilter
    ? files.filter((f) => (Array.isArray(f.tags) ? f.tags.includes(tagFilter) : false))
    : files

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Files</h2>
        <div className="mt-4 h-24 animate-pulse rounded bg-gray-100" />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Files</h2>
        {canUpload && clinicId && (
          <label className="cursor-pointer">
            <input type="file" className="sr-only" onChange={handleUpload} disabled={uploading} />
            <span className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {uploading ? 'Uploading...' : 'Upload'}
            </span>
          </label>
        )}
      </div>
      {allTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              !tagFilter
                ? 'bg-primary-100 text-primary-800'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter(tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                tagFilter === tag
                  ? 'bg-primary-100 text-primary-800'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      {filteredFiles.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No files</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {filteredFiles.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{file.originalName}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {formatSize(file.size)} • {formatDate(file.createdAt)} • {file.uploadedBy.name}
                </p>
                {Array.isArray(file.tags) && file.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {file.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                <FilePreview file={file} clinicId={clinicId} asPatient={asPatient} />
                <button
                  type="button"
                  onClick={() =>
                    asPatient
                      ? downloadMyFile(file.id, file.originalName, clinicId)
                      : downloadPatientFile(file.id, file.originalName, clinicId)
                  }
                  className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Download
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(file.id)}
                    disabled={deleteMutation.isPending}
                    className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 hover:border-red-300"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
