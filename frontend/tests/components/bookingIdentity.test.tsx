/**
 * Demo feedback WS1 — the Review step's "who is this booking for" pieces:
 * details come from the profile (no re-entry, no password), a missing phone
 * is asked for once, and a signed-out visitor gets the sign-in gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@/lib/types'

const refetchUser = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ refetchUser }) }))
const patch = vi.fn()
vi.mock('@/lib/api', () => ({ default: { patch: (...a: unknown[]) => patch(...a) } }))

import {
  BookingSignInGate,
  YourDetailsCard,
  isValidPhone,
} from '@/components/booking/BookingIdentity'

const patient: User = {
  id: 'p1',
  name: 'Jane Synthetic',
  email: 'jane@example.test',
  phone: '+1 555 010 2030',
  role: 'PATIENT',
  clinicId: 'c1',
}

beforeEach(() => {
  refetchUser.mockReset()
  patch.mockReset()
})

describe('YourDetailsCard', () => {
  it('shows name, email and phone from the profile, with no form fields at all', () => {
    const { container } = render(<YourDetailsCard user={patient} />)
    expect(screen.getByText('Jane Synthetic')).toBeInTheDocument()
    expect(screen.getByText('jane@example.test')).toBeInTheDocument()
    expect(screen.getByText('+1 555 010 2030')).toBeInTheDocument()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it('asks once for a missing phone, validates it, and saves it to the profile', async () => {
    patch.mockResolvedValue({ data: {} })
    render(<YourDetailsCard user={{ ...patient, phone: null }} />)
    const input = screen.getByLabelText(/add a phone number/i)

    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid phone/i)
    expect(patch).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: ' (555) 010-4455 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/auth/me', { phone: '(555) 010-4455' }))
    await waitFor(() => expect(refetchUser).toHaveBeenCalled())
  })

  it('shows the server message when saving fails', async () => {
    patch.mockRejectedValue({
      response: { status: 400, data: { message: 'Enter a valid phone number' } },
    })
    render(<YourDetailsCard user={{ ...patient, phone: null }} />)
    fireEvent.change(screen.getByLabelText(/add a phone number/i), {
      target: { value: '5550104455' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid phone number')
  })
})

describe('BookingSignInGate', () => {
  it('offers sign in and create account, with no inputs of its own', () => {
    const onSignIn = vi.fn()
    const onCreateAccount = vi.fn()
    const { container } = render(
      <BookingSignInGate onSignIn={onSignIn} onCreateAccount={onCreateAccount} />
    )
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(onSignIn).toHaveBeenCalledOnce()
    expect(onCreateAccount).toHaveBeenCalledOnce()
    expect(container.querySelector('input')).toBeNull()
  })
})

describe('isValidPhone (same rule as the API)', () => {
  it.each([
    ['+1 (555) 010-2030', true],
    ['555.010.2030', true],
    ['5550102', true],
    ['123456', false],
    ['+1234567890123456', false],
    ['555-CALL-NOW', false],
    ['', false],
  ])('%s → %s', (value, ok) => {
    expect(isValidPhone(value)).toBe(ok)
  })
})
