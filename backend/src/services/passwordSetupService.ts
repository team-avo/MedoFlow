import crypto from 'crypto'
import * as argon2 from 'argon2'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'

const TOKEN_BYTES = 32
const EXPIRY_HOURS = 24

export async function createPasswordSetupToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + EXPIRY_HOURS)

  await prisma.passwordSetupToken.create({
    data: { userId, token, expiresAt },
  })

  return token
}

export async function redeemPasswordSetupToken(
  token: string,
  newPassword: string
): Promise<{ userId: string; email: string }> {
  const trimmed = token?.trim()
  if (!trimmed) {
    const err = new Error('Invalid or expired token') as ApiError
    err.statusCode = 400
    throw err
  }

  if (!newPassword || newPassword.length < 6) {
    const err = new Error('Password must be at least 6 characters') as ApiError
    err.statusCode = 400
    throw err
  }

  const record = await prisma.passwordSetupToken.findUnique({
    where: { token: trimmed },
    include: { user: { select: { id: true, email: true } } },
  })

  if (!record) {
    const err = new Error('Invalid or expired token') as ApiError
    err.statusCode = 400
    throw err
  }

  if (new Date() > record.expiresAt) {
    await prisma.passwordSetupToken.delete({ where: { id: record.id } })
    const err = new Error('Invalid or expired token') as ApiError
    err.statusCode = 400
    throw err
  }

  const hashedPassword = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword },
    }),
    prisma.passwordSetupToken.delete({ where: { id: record.id } }),
  ])

  return { userId: record.user.id, email: record.user.email }
}
