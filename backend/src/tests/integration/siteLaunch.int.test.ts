/**
 * CTO-26: publishing the website puts the clinic's address live on
 * Cloudflare Pages with no manual step (Cloudflare stubbed). A queued job with
 * a status the owner sees, retried, idempotent, a clear failure the platform
 * team hears about, and removed on off-boarding.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { setPagesClientForTests } from '../../site/frontDoor/pagesClient'
import {
  isLaunchableLabel,
  setSiteLaunchQueueForTests,
} from '../../site/services/siteLaunchService'

let server: TestServer
let fx: ClinicFixture
let owner = ''
const deployed: string[] = []
const deleted: string[] = []
let failNext = 0

beforeAll(async () => {
  setSiteLaunchQueueForTests(null) // in-process, no Redis
  setPagesClientForTests({
    deployBranch: async (label: string) => {
      if (failNext > 0) {
        failNext -= 1
        throw new Error('Cloudflare answered 500')
      }
      deployed.push(label)
      return { id: `dep-${deployed.length}`, url: `https://${label}.medoflow.pages.dev` }
    },
    deleteBranch: async (label: string) => {
      deleted.push(label)
      return 1
    },
  })
  server = await startServer()
  fx = await createClinicFixture('launch')
  owner = (await login(server.url, fx.users.admin.email)).accessToken
  await adminDb.siteDomain.create({
    data: {
      clinicId: fx.clinicId,
      hostname: `launch${Date.now().toString(36)}`,
      kind: 'SUBDOMAIN',
      status: 'VERIFIED',
      isPrimary: true,
    },
  })
})
afterEach(() => {
  failNext = 0
})
afterAll(async () => {
  setPagesClientForTests(null)
  setSiteLaunchQueueForTests(undefined)
  await server.close()
})

const status = async () => (await api(server.url, '/site/launch', { token: owner })).body.data
const waitFor = async (want: string) => {
  for (let i = 0; i < 50; i++) {
    const s = await status()
    if (s.status === want) return s
    await new Promise((r) => setTimeout(r, 50))
  }
  return status()
}

describe('site launch', () => {
  it('Publish deploys the address once; publishing again does not redeploy', async () => {
    const pub = await api(server.url, '/site/publish', { token: owner, body: { pageIds: 'all' } })
    expect(pub.status, JSON.stringify(pub.body)).toBe(200)
    const live = await waitFor('LIVE')
    expect(live).toMatchObject({
      status: 'LIVE',
      url: expect.stringMatching(/\.medoflow\.pages\.dev$/),
    })
    expect(deployed).toHaveLength(1)
    await api(server.url, '/site/publish', { token: owner, body: { pageIds: 'all' } })
    await new Promise((r) => setTimeout(r, 200))
    expect(deployed).toHaveLength(1) // idempotent
    expect(
      await adminDb.auditLog.count({
        where: { clinicId: fx.clinicId, action: 'SITE_ADDRESS_LIVE' },
      })
    ).toBe(1)
  })

  it('a transient failure is retried; a lasting one is FAILED with a reason and can be retried', async () => {
    failNext = 1
    await api(server.url, '/site/launch/retry', { token: owner, body: {} })
    expect((await waitFor('LIVE')).attempts).toBe(2)

    failNext = 3
    await api(server.url, '/site/launch/retry', { token: owner, body: {} })
    const failed = await waitFor('FAILED')
    expect(failed).toMatchObject({
      status: 'FAILED',
      lastError: 'Cloudflare answered 500',
      attempts: 3,
    })
    expect(
      await adminDb.auditLog.count({
        where: { clinicId: fx.clinicId, action: 'SITE_ADDRESS_FAILED' },
      })
    ).toBe(1)

    await api(server.url, '/site/launch/retry', { token: owner, body: {} })
    expect((await waitFor('LIVE')).lastError).toBeNull()
  })

  it('front desk cannot launch; labels follow the front-door rules', async () => {
    const frontDesk = (await login(server.url, fx.users.frontDesk.email)).accessToken
    expect(
      (await api(server.url, '/site/launch/retry', { token: frontDesk, body: {} })).status
    ).toBe(403)
    expect(isLaunchableLabel('everwell')).toBe(true)
    for (const bad of ['medoflow', 'www', 'admin', 'Bad_Label', 'a', '-x-']) {
      expect(isLaunchableLabel(bad), bad).toBe(false)
    }
  })
})

describe('off-boarding', () => {
  it('takes the address down', async () => {
    const row = await adminDb.siteLaunch.findUniqueOrThrow({ where: { clinicId: fx.clinicId } })
    const { withTenantBypass } = await import('../../config/tenantContext')
    const { removeLaunch } = await import('../../site/services/siteLaunchService')
    expect(await withTenantBypass('test:offboard', () => removeLaunch(fx.clinicId))).toBe(1)
    expect(deleted).toContain(row.label)
    expect(
      (await adminDb.siteLaunch.findUniqueOrThrow({ where: { clinicId: fx.clinicId } })).status
    ).toBe('REMOVED')
  })
})

describe('without Cloudflare configured', () => {
  it('launches are off and say so', async () => {
    setPagesClientForTests(null)
    const prevToken = process.env.CF_PAGES_API_TOKEN
    delete process.env.CF_PAGES_API_TOKEN
    try {
      expect((await status()).status).toBe('NOT_CONFIGURED')
    } finally {
      if (prevToken) process.env.CF_PAGES_API_TOKEN = prevToken
    }
  })
})
