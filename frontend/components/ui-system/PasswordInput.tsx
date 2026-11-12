'use client'

/**
 * A password field with a "Show password" eye button (CTO-07). One shared
 * component for every password input: sign-up, set password and the sign-in
 * modal.
 *
 * The button only switches the input between `password` and `text`; the
 * value, name, autocomplete hint and validation are untouched, so the form
 * submits the same in both states. It's a real button (keyboard reachable),
 * labelled "Show password" / "Hide password" with `aria-pressed`, and never
 * submits the form.
 */
import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PasswordInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  /** The input component to render (e.g. AppInput); a plain input by default. */
  as?: React.ElementType
  /** Classes for the wrapper that positions the button. */
  wrapperClassName?: string
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ as: Component = 'input', className, wrapperClassName, ...props }, ref) {
    const [shown, setShown] = React.useState(false)
    return (
      <div className={cn('relative', wrapperClassName)}>
        <Component
          ref={ref}
          {...props}
          type={shown ? 'text' : 'password'}
          className={cn(className, 'pr-10')}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          aria-controls={props.id}
          className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {shown ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    )
  }
)
