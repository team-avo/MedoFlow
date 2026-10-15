/**
 * F0.3.4 minimum necessary: a Prisma `include: { patient: true }` (or
 * `user: true`) returns the whole User row — password hash, MFA secret and
 * recovery codes included. Response-building code must `select` the fields
 * the screen shows. The only allowed full includes are server-internal (they
 * never reach a response) and are listed here with the reason.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..')
const ALLOWED: Record<string, string> = {
  'services/notificationService.ts': 'builds outbound emails server-side; nothing is returned',
  'controllers/webhookController.ts': 'Stripe webhook; responds { received: true } only',
  'controllers/authController.ts': 'refresh-token lookup; reads isActive/clinicId, never returned',
}

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory() ? files(full) : e.name.endsWith('.ts') ? [full] : []
  })
}

describe('no full User rows in responses (F0.3.4)', () => {
  it('services/controllers never include patient/user: true outside the internal allow-list', () => {
    const hits: string[] = []
    for (const file of [
      ...files(path.join(SRC, 'services')),
      ...files(path.join(SRC, 'controllers')),
    ]) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      if (ALLOWED[rel]) continue
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line)) return // comments
          if (/\b(patient|user|caller)\s*:\s*true\b/.test(line))
            hits.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(hits).toEqual([])
  })
})
