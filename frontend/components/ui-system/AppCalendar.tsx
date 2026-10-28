'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { cn } from '@/lib/utils'
import { AppButton } from './AppButton'

export type AppCalendarProps = React.ComponentProps<typeof DayPicker>

function AppCalendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: AppCalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3 bg-white', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        month_caption: 'flex justify-center pt-1 relative items-center mb-4',
        caption_label: 'text-sm font-bold text-slate-900',
        nav: 'space-x-1 flex items-center',
        button_previous: cn(
          'h-8 w-8 bg-transparent p-0 opacity-50 hover:opacity-100 transition-opacity flex items-center justify-center rounded-full hover:bg-slate-100 absolute left-1 z-10'
        ),
        button_next: cn(
          'h-8 w-8 bg-transparent p-0 opacity-50 hover:opacity-100 transition-opacity flex items-center justify-center rounded-full hover:bg-slate-100 absolute right-1 z-10'
        ),
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday:
          'text-slate-400 rounded-md w-10 font-bold text-[10px] uppercase tracking-widest text-center',
        week: 'flex w-full mt-2',
        day: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-primary-50 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md rounded-md'
        ),
        day_button: cn(
          'h-10 w-10 p-0 font-bold aria-selected:opacity-100 hover:bg-slate-100 rounded-full transition-colors text-slate-700 flex items-center justify-center'
        ),
        range_start: 'day-range-start',
        range_end: 'day-range-end',
        selected:
          'bg-primary-600 text-white hover:bg-primary-700 hover:text-white focus:bg-primary-600 focus:text-white',
        today: 'bg-slate-100 text-slate-900',
        outside: 'text-slate-300 opacity-50',
        disabled: 'text-slate-300 opacity-50 cursor-not-allowed',
        range_middle: 'aria-selected:bg-primary-50 aria-selected:text-primary-900',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ ...props }) => {
          if (props.orientation === 'left') return <ChevronLeft className="h-4 w-4" />
          return <ChevronRight className="h-4 w-4" />
        },
      }}
      {...props}
    />
  )
}
AppCalendar.displayName = 'AppCalendar'

export { AppCalendar }
