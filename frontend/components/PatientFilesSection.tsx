'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPatientFiles,
  getMyFiles,
  uploadPatientFile,
  deletePatientFile,
  downloadPatientFile,
  fetchPatientFileBlob,
  FileTransferError,
  type PatientFile,
} from '@/lib/fileApi'
import { FILE_ACCEPT, fileUploadProblem, isPreviewable } from '@/lib/fileConstants'
import { extractApiError } from '@/lib/apiErrors'
import { useAppToast } from '@/hooks/useAppToast'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  // toLocaleString: toLocaleDateString throws when given timeStyle.
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** A safe, filename-free message for any file failure (F0.3.2 / F3.3). */
function fileErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof FileTransferError) {
    return err.status === 403
      ? 'The file link expired or was refused. Please try again.'
      : 'The file transfer did not complete. Please try again.'
  }
  const { status, message } = extractApiError(err, fallback)
  if (status === 403) return 'You do not have access to this file.'
  if (status === 404) return 'This file is no longer available.'
  return message
}

interface FileAccess {
  asPatient: boolean
  clinicId?: string
}

function FilePreview({ file, access }: { file: PatientFile; access: FileAccess }) {
  const toast = useAppToast()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const close = useCallback(() => {
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url)
      return null
    })
  }, [])

  useEffect(() => {
    if (!previewUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewUrl, close])

  if (!isPreviewable(file.mimeType)) return null

  const open = async () => {
    setLoading(true)
    try {
      // Fresh presigned URL every time; the bytes become a local object URL.
      const { blob } = await fetchPatientFileBlob(file.id, access)
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (err) {
      toast.error(fileErrorMessage(err, 'Could not open the file'))
    } finally {
      setLoading(false)
    }
  }

  const isImage = file.mimeType.toLowerCase().startsWith('image/')

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50"
      >
        {loading ? 'Opening…' : 'Preview'}
      </button>
      {previewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="File preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={close}
        >
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 rounded bg-white px-3 py-1 text-sm font-medium text-gray-800"
          >
            Close
          </button>
          <div
            className="max-h-[90vh] max-w-[90vw] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL of a server-verified image; must not go through the image optimiser
              <img src={previewUrl} alt="File preview" className="max-h-[90vh] object-contain" />
            ) : (
              // The blob is typed application/pdf and its bytes were verified
              // as PDF by the API, so the browser's PDF viewer renders it.
              <iframe src={previewUrl} title="File preview" className="h-[90vh] w-[90vw]" />
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
  const access: FileAccess = { asPatient, clinicId }

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files', asPatient ? 'me' : 'patient', patientId, clinicId],
    queryFn: () => (asPatient ? getMyFiles(clinicId) : getPatientFiles(patientId)),
    enabled: !!patientId || asPatient,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['files', 'patient', patientId] })
    void queryClient.invalidateQueries({ queryKey: ['files', 'me'] })
  }

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => deletePatientFile(fileId),
    onSuccess: () => {
      refresh()
      toast.success('File deleted')
    },
    onError: (err) => toast.error(fileErrorMessage(err, 'Failed to delete file')),
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    // Same rules as the API (type allow-list + size), checked before any request.
    const problem = fileUploadProblem(file)
    if (problem) {
      toast.error(problem)
      input.value = ''
      return
    }
    setUploading(true)
    try {
      await uploadPatientFile(file, { patientId })
      refresh()
      toast.success('File uploaded')
    } catch (err) {
      toast.error(fileErrorMessage(err, 'Failed to upload file'))
    } finally {
      setUploading(false)
      input.value = ''
    }
  }

  const handleDownload = async (file: PatientFile) => {
    try {
      await downloadPatientFile(file.id, file.originalName, access)
    } catch (err) {
      toast.error(fileErrorMessage(err, 'Failed to download file'))
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
        {canUpload && !asPatient && (
          <label className="cursor-pointer">
            <input
              type="file"
              className="sr-only"
              accept={FILE_ACCEPT}
              onChange={handleUpload}
              disabled={uploading}
              aria-label="Upload file"
            />
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
                <FilePreview file={file} access={access} />
                <button
                  type="button"
                  onClick={() => void handleDownload(file)}
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
