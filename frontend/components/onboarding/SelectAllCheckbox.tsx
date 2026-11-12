'use client'

import * as React from 'react'

/**
 * "I agree to all of the above" (CTO-08). Ticks or clears every
 * acknowledgement; shows the mixed state when only some are ticked. The
 * individual boxes stay, so the record still shows what was agreed.
 */
export function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (on: boolean) => void
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
      />
      I agree to all of the above
    </label>
  )
}
