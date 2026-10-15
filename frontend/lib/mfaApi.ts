import api from './api'

/** MFA enrolment endpoints (backend B0.2.2). The secret is shown once, during setup. */

export async function beginMfaSetup(): Promise<{ secret: string; otpauthUrl: string }> {
  const { data } = await api.post<{ data: { secret: string; otpauthUrl: string } }>(
    '/auth/mfa/setup'
  )
  return data.data
}

export async function enableMfa(code: string): Promise<{ recoveryCodes: string[] }> {
  const { data } = await api.post<{ data: { recoveryCodes: string[] } }>('/auth/mfa/enable', {
    code,
  })
  return data.data
}

export async function disableMfa(factor: { code: string } | { recoveryCode: string }) {
  await api.post('/auth/mfa/disable', factor)
}
