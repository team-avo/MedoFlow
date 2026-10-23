'use client'

/** Website image library: upload (drag & drop), alt text, delete — and a picker for image fields. */
import React from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { siteApi, siteErrorMessage, type SiteAsset } from '@/lib/site/siteApi'
import { cn } from '@/lib/utils'
import { useInvalidateSite } from './BuilderData'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp,image/gif'
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Client-side check before asking the API for an upload URL. */
export function imageUploadProblem(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_IMAGES.split(',').includes(file.type)) return 'Use a JPEG, PNG, WebP or GIF image'
  if (file.size > MAX_IMAGE_BYTES) return 'Images can be up to 5 MB'
  if (file.size === 0) return 'That file is empty'
  return null
}

export function MediaLibrary({
  onPick,
  selectedId,
}: {
  onPick?: (a: SiteAsset) => void
  selectedId?: string | null
}) {
  const qc = useQueryClient()
  const invalidate = useInvalidateSite()
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['site', 'assets'],
    queryFn: siteApi.listAssets,
  })
  const [uploading, setUploading] = React.useState(0)
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const problem = imageUploadProblem(file)
      if (problem) {
        toast.error(problem)
        continue
      }
      setUploading((n) => n + 1)
      try {
        const asset = await siteApi.uploadAsset(
          file,
          file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
        )
        qc.setQueryData<SiteAsset[]>(['site', 'assets'], (old = []) => [asset, ...old])
        invalidate()
        toast.success('Image uploaded')
      } catch (e) {
        toast.error(siteErrorMessage(e, 'Upload failed'))
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const remove = async (a: SiteAsset) => {
    try {
      await siteApi.deleteAsset(a.id)
      qc.setQueryData<SiteAsset[]>(['site', 'assets'], (old = []) =>
        old.filter((x) => x.id !== a.id)
      )
      invalidate()
    } catch (e) {
      toast.error(siteErrorMessage(e, 'Could not delete'))
    }
  }

  const saveAlt = async (a: SiteAsset, alt: string) => {
    if (alt === a.alt) return
    try {
      const next = await siteApi.updateAssetAlt(a.id, alt)
      qc.setQueryData<SiteAsset[]>(['site', 'assets'], (old = []) =>
        old.map((x) => (x.id === a.id ? next : x))
      )
      invalidate()
    } catch (e) {
      toast.error(siteErrorMessage(e))
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload images"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void upload(e.dataTransfer.files)
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center text-sm transition-colors',
          dragOver
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        )}
      >
        {uploading > 0 ? (
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        ) : (
          <ImagePlus className="h-6 w-6 text-slate-400" />
        )}
        <span className="font-medium text-slate-700">
          {uploading > 0 ? `Uploading ${uploading}…` : 'Drop images here or click to upload'}
        </span>
        <span className="text-xs text-slate-500">JPEG, PNG, WebP or GIF · up to 5 MB</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGES}
          multiple
          className="hidden"
          data-testid="media-upload-input"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-slate-500">Loading images…</p>
      ) : assets.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No images yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => (
            <li
              key={a.id}
              className={cn(
                'group overflow-hidden rounded-xl border bg-white',
                selectedId === a.id
                  ? 'border-indigo-500 ring-2 ring-indigo-200'
                  : 'border-slate-200'
              )}
            >
              <button
                type="button"
                className="block aspect-[4/3] w-full bg-slate-100"
                onClick={() => onPick?.(a)}
                disabled={!onPick}
                aria-label={onPick ? `Use ${a.alt || 'image'}` : undefined}
              >
                {a.url && (
                  // eslint-disable-next-line @next/next/no-img-element -- uploaded site image served from the site-assets bucket
                  <img
                    src={a.url}
                    alt={a.alt}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </button>
              <div className="flex items-center gap-1 p-2">
                <input
                  aria-label="Alt text"
                  defaultValue={a.alt}
                  placeholder="Describe the image"
                  maxLength={200}
                  onBlur={(e) => void saveAlt(a, e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-xs text-slate-700 hover:border-slate-200 focus:border-indigo-400 focus:outline-none"
                />
                {!onPick && (
                  <button
                    type="button"
                    onClick={() => void remove(a)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete image"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {a.width && a.height && (
                <p className="px-3 pb-2 text-[11px] text-slate-400">
                  {a.width}×{a.height}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
