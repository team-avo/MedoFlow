import fs from 'fs'
import path from 'path'
import { scrubPhi, scrubText } from './phiScrubber'

/**
 * Structured error log. Message, stack and context are PHI-scrubbed (B0.3.5):
 * Prisma errors echo query arguments, and thrown messages can embed patient
 * names or emails.
 */
export const logError = (err: unknown, context?: Record<string, unknown>): void => {
  const message = scrubText(err instanceof Error ? err.message : String(err))
  const stack = err instanceof Error && err.stack ? scrubText(err.stack) : undefined
  const payload = {
    timestamp: new Date().toISOString(),
    message,
    stack,
    ...scrubPhi(context ?? {}),
  }
  if (process.env.NODE_ENV === 'production') {
    try {
      const logDir = path.join(process.cwd(), 'logs')
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
      fs.appendFileSync(path.join(logDir, 'errors.log'), JSON.stringify(payload) + '\n')
    } catch {
      process.stderr.write(JSON.stringify(payload) + '\n')
    }
  } else {
    process.stderr.write(JSON.stringify(payload, null, 2) + '\n')
  }
}
