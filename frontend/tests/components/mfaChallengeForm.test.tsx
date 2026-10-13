/** F0.2.2 — the MFA challenge screen: valid / invalid code, recovery code, keyboard only. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { MfaChallengeForm } from '@/components/auth/MfaChallengeForm'

const verifyMfa = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ verifyMfa }) }))

const apiError = (status: number, code: string) => {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('x', 'ERR', config as never, null, {
    status,
    statusText: '',
    headers: {},
    config: config as never,
    data: { code, message: 'Invalid verification code' },
  })
}

const signedIn = { id: 'u1', role: 'PROVIDER' }

beforeEach(() => {
  verifyMfa.mockReset()
})

describe('MfaChallengeForm', () => {
  it('focuses the code field; a valid code typed + Enter (keyboard only) signs in', async () => {
    verifyMfa.mockResolvedValue(signedIn)
    const onVerified = vi.fn()
    render(<MfaChallengeForm mfaToken="t1" onVerified={onVerified} onRestart={vi.fn()} />)
    const input = screen.getByLabelText('Verification code')
    expect(input).toHaveFocus()
    await userEvent.keyboard('123456{Enter}')
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(signedIn))
    expect(verifyMfa).toHaveBeenCalledWith('t1', { code: '123456' })
  })

  it('an invalid code fails with an announced error tied to the field, and does not sign in', async () => {
    verifyMfa.mockImplementation(async () => {
      throw apiError(401, 'mfa_invalid_code')
    })
    const onVerified = vi.fn()
    render(<MfaChallengeForm mfaToken="t1" onVerified={onVerified} onRestart={vi.fn()} />)
    await userEvent.keyboard('000000{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That code is not valid')
    const input = screen.getByLabelText('Verification code')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', alert.id)
    expect(input).toHaveFocus()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('malformed input is rejected client-side without a request', async () => {
    render(<MfaChallengeForm mfaToken="t1" onVerified={vi.fn()} onRestart={vi.fn()} />)
    await userEvent.keyboard('12ab{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('6-digit code')
    expect(verifyMfa).not.toHaveBeenCalled()
  })

  it('recovery-code path is reachable by keyboard and sends a recovery code', async () => {
    verifyMfa.mockResolvedValue(signedIn)
    render(<MfaChallengeForm mfaToken="t1" onVerified={vi.fn()} onRestart={vi.fn()} />)
    await userEvent.tab() // Verify button
    await userEvent.tab() // "Use a recovery code"
    expect(screen.getByRole('button', { name: 'Use a recovery code' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByLabelText('Recovery code')).toHaveFocus()
    await userEvent.keyboard('abcd-ef12-3456{Enter}')
    await waitFor(() =>
      expect(verifyMfa).toHaveBeenCalledWith('t1', { recoveryCode: 'abcd-ef12-3456' })
    )
  })

  it('an expired challenge offers to sign in again', async () => {
    verifyMfa.mockImplementation(async () => {
      throw apiError(401, 'mfa_challenge_invalid')
    })
    const onRestart = vi.fn()
    render(<MfaChallengeForm mfaToken="t1" onVerified={vi.fn()} onRestart={onRestart} />)
    await userEvent.keyboard('123456{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in again' }))
    expect(onRestart).toHaveBeenCalled()
  })
})
