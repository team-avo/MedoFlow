/** CTO-07: the shared "Show password" toggle. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { PasswordInput } from '@/components/ui-system/PasswordInput'
import { AppInput } from '@/components/ui-system'

function Form({ onSubmit }: { onSubmit: (v: string) => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(new FormData(e.currentTarget).get('password') as string)
      }}
    >
      <label htmlFor="pw">Password</label>
      <PasswordInput as={AppInput} id="pw" name="password" autoComplete="new-password" />
      <button type="submit">Save</button>
    </form>
  )
}

describe('PasswordInput', () => {
  it('shows and hides the password without changing the value, autocomplete or submit', () => {
    const onSubmit = vi.fn()
    render(<Form onSubmit={onSubmit} />)
    const input = screen.getByLabelText('Password') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'Secret-Pass-2026' } })

    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('type', 'button') // never submits the form
    fireEvent.click(toggle)
    expect(input.type).toBe('text')
    expect(input.value).toBe('Secret-Pass-2026')
    expect(input.autocomplete).toBe('new-password')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(onSubmit).not.toHaveBeenCalled()

    // Submits the same value shown...
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenLastCalledWith('Secret-Pass-2026')
    // ...and hidden.
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenLastCalledWith('Secret-Pass-2026')
  })

  it('forwards the ref (react-hook-form register) and is keyboard reachable', () => {
    const ref = React.createRef<HTMLInputElement>()
    render(<PasswordInput ref={ref} id="x" aria-label="Password" />)
    expect(ref.current).toBe(screen.getByLabelText('Password'))
    const toggle = screen.getByRole('button', { name: 'Show password' })
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    expect(toggle).toHaveAttribute('aria-controls', 'x')
  })
})
