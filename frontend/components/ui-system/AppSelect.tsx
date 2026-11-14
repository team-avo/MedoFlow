'use client'

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AppFormField } from './AppFormField'
import { cn } from '@/lib/utils'

export interface AppSelectOption {
  label: string
  value: string
  disabled?: boolean
}

export interface AppSelectProps {
  /** The options to render. Ignored when `children` is provided. */
  options?: AppSelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  /** When set, the control is wrapped in an AppFormField with this label. */
  label?: string
  description?: string
  error?: string
  required?: boolean
  id?: string
  name?: string
  disabled?: boolean
  /** className for the trigger. */
  className?: string
  contentClassName?: string
  /** Custom <SelectItem> children; used instead of `options` when provided. */
  children?: React.ReactNode
}

/**
 * Branded select built on the themed `ui/select` primitive (UI-03). Use for
 * form dropdowns so they match AppInput: same radius, border, and accent focus
 * ring, with label/description/error handled by AppFormField.
 */
const AppSelect = React.forwardRef<React.ElementRef<typeof SelectTrigger>, AppSelectProps>(
  function AppSelect(
    {
      options,
      value,
      defaultValue,
      onValueChange,
      placeholder = 'Select an option',
      label,
      description,
      error,
      required,
      id,
      name,
      disabled,
      className,
      contentClassName,
      children,
    },
    ref
  ) {
    const control = (
      <Select
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
      >
        <SelectTrigger
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          className={cn(
            error &&
              'border-danger focus-visible:border-danger focus-visible:ring-danger/20 data-[state=open]:border-danger data-[state=open]:ring-danger/20',
            className
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className={contentClassName}>
          {children ??
            options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    )

    if (!label) return control

    return (
      <AppFormField
        label={label}
        description={description}
        error={error}
        htmlFor={id}
        required={required}
      >
        {control}
      </AppFormField>
    )
  }
)

export { AppSelect }
