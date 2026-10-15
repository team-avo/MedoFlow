/**
 * One-off script: set password for a user by email.
 * Usage: npx ts-node -r dotenv/config scripts/set-password.ts
 * Required env: SET_PASSWORD_EMAIL and SET_PASSWORD_PLAIN (no defaults — never commit real accounts or passwords).
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EMAIL = process.env.SET_PASSWORD_EMAIL ?? ''
const PASSWORD = process.env.SET_PASSWORD_PLAIN ?? ''
if (!EMAIL || !PASSWORD) {
  console.error('Set SET_PASSWORD_EMAIL and SET_PASSWORD_PLAIN')
  process.exit(1)
}

async function main() {
  const hashed = await bcrypt.hash(PASSWORD, 12)
  const user = await prisma.user.updateMany({
    where: { email: EMAIL.toLowerCase() },
    data: { password: hashed },
  })
  if (user.count === 0) {
    console.error(`No user found with email: ${EMAIL}`)
    process.exit(1)
  }
  console.log(`Password updated for ${EMAIL}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
