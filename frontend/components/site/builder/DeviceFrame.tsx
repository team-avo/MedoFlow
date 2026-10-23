'use client'

/**
 * Desktop / tablet / phone previews. The site renders at the device's real
 * width (so its container queries pick the right layout) and is scaled down
 * to fit the space available — a desktop preview stays a desktop layout
 * even in a narrow editor column.
 */
import React from 'react'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Device = 'desktop' | 'tablet' | 'mobile'
export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 }

export function DeviceToggle({
  value,
  onChange,
}: {
  value: Device
  onChange: (d: Device) => void
}) {
  const opts: { d: Device; icon: typeof Monitor; label: string }[] = [
    { d: 'desktop', icon: Monitor, label: 'Desktop' },
    { d: 'tablet', icon: Tablet, label: 'Tablet' },
    { d: 'mobile', icon: Smartphone, label: 'Phone' },
  ]
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5"
      role="group"
      aria-label="Preview width"
    >
      {opts.map(({ d, icon: Icon, label }) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={value === d}
          aria-label={label}
          title={label}
          className={cn(
            'rounded-md p-1.5',
            value === d ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  )
}

export function DeviceFrame({ device, children }: { device: Device; children: React.ReactNode }) {
  const outer = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLDivElement>(null)
  const [available, setAvailable] = React.useState(0)
  const [innerHeight, setInnerHeight] = React.useState(0)
  const width = DEVICE_WIDTH[device]

  React.useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setAvailable(o.clientWidth)
      setInnerHeight(i.scrollHeight)
    })
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [])

  const scale = available > 0 ? Math.min(1, available / width) : 1
  return (
    <div
      ref={outer}
      className="w-full"
      style={{ height: innerHeight ? innerHeight * scale : undefined }}
      data-testid="device-frame"
      data-scale={scale.toFixed(3)}
    >
      <div
        ref={inner}
        className={cn(
          'origin-top-left overflow-hidden bg-white shadow-sm',
          device !== 'desktop' && 'rounded-2xl border border-slate-300'
        )}
        style={{
          width,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          marginLeft: scale >= 1 ? Math.max(0, (available - width) / 2) : 0,
        }}
      >
        {children}
      </div>
    </div>
  )
}
