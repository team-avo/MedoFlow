import React from 'react'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DateRangeOption = 'ALL_TIME' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_YEAR' | 'LAST_MONTH'

export interface DateRange {
  startDate?: Date
  endDate?: Date
}

interface DateRangeFilterProps {
  value: DateRangeOption
  onChange: (value: DateRangeOption, range: DateRange) => void
  className?: string
}

export function getDateRange(option: DateRangeOption): DateRange {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (option) {
    case 'THIS_WEEK': {
      const startOfWeek = new Date(startOfDay)
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(endOfWeek.getDate() + 6)
      endOfWeek.setHours(23, 59, 59, 999)
      return { startDate: startOfWeek, endDate: endOfWeek }
    }
    case 'THIS_MONTH': {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      return { startDate: startOfMonth, endDate: endOfMonth }
    }
    case 'LAST_MONTH': {
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      return { startDate: startOfLastMonth, endDate: endOfLastMonth }
    }
    case 'THIS_YEAR': {
      const startOfYear = new Date(now.getFullYear(), 0, 1)
      const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
      return { startDate: startOfYear, endDate: endOfYear }
    }
    case 'ALL_TIME':
    default:
      return { startDate: undefined, endDate: undefined }
  }
}

const LABELS: Record<DateRangeOption, string> = {
  ALL_TIME: 'All Time',
  THIS_WEEK: 'This Week',
  THIS_MONTH: 'This Month',
  LAST_MONTH: 'Last Month',
  THIS_YEAR: 'This Year',
}

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const handleSelect = (option: DateRangeOption) => {
    onChange(option, getDateRange(option))
  }

  return (
    <div className="relative inline-flex items-center">
      <Calendar className="absolute left-3 h-4 w-4 text-slate-500 pointer-events-none" />
      <select
        value={value}
        onChange={(e) => handleSelect(e.target.value as DateRangeOption)}
        className={cn(
          'appearance-none bg-white border border-slate-200 text-slate-700 shadow-sm',
          'h-10 pl-9 pr-8 py-2 rounded-xl text-sm font-semibold transition-colors',
          'hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer',
          className
        )}
      >
        {Object.entries(LABELS).map(([key, label]) => (
          <option key={key} value={key} className="font-medium text-slate-700 py-1">
            {label}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </div>
  )
}
