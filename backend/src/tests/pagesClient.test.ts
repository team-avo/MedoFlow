/** CTO-26: the Cloudflare Pages Direct Upload call (fake fetch; nothing leaves the machine). */
import { describe, expect, it } from 'vitest'
import { FRONT_DOOR_WORKER, PagesClient, pagesConfig } from '../site/frontDoor/pagesClient'

const cfg = { token: 'cf-token-synthetic', accountId: 'acc123', project: 'medoflow' }

describe('PagesClient', () => {
  it('deploys the front-door worker to branch <label> with the token in a header only', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = new PagesClient(cfg, (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ success: true, result: { id: 'dep-1' } }), {
        status: 200,
      })
    }) as typeof fetch)
    const out = await client.deployBranch('everwell')
    expect(out).toEqual({ id: 'dep-1', url: 'https://everwell.medoflow.pages.dev' })
    expect(calls[0]!.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc123/pages/projects/medoflow/deployments'
    )
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer cf-token-synthetic'
    )
    const form = calls[0]!.init.body as FormData
    expect(form.get('branch')).toBe('everwell')
    expect(form.get('manifest')).toBe('{}')
    expect(await (form.get('_worker.js') as Blob).text()).toBe(FRONT_DOOR_WORKER)
    expect(calls[0]!.url).not.toContain('cf-token')
  })

  it("surfaces Cloudflare's own error message, never the token", async () => {
    const client = new PagesClient(
      cfg,
      (async () =>
        new Response(
          JSON.stringify({ success: false, errors: [{ message: 'Project not found' }] }),
          {
            status: 404,
          }
        )) as typeof fetch
    )
    await expect(client.deployBranch('everwell')).rejects.toThrow('Project not found')
  })

  it('deletes only the deployments of that branch', async () => {
    const deletes: string[] = []
    const client = new PagesClient(cfg, (async (url: string, init: RequestInit) => {
      if (init.method === 'DELETE') {
        deletes.push(url)
        return new Response(JSON.stringify({ success: true, result: null }))
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: [
            { id: 'a', deployment_trigger: { metadata: { branch: 'everwell' } } },
            { id: 'b', deployment_trigger: { metadata: { branch: 'other' } } },
          ],
        })
      )
    }) as typeof fetch)
    expect(await client.deleteBranch('everwell')).toBe(1)
    expect(deletes).toEqual([
      'https://api.cloudflare.com/client/v4/accounts/acc123/pages/projects/medoflow/deployments/a?force=true',
    ])
  })

  it('is off unless both the token and the account are set', () => {
    expect(pagesConfig({})).toBeNull()
    expect(pagesConfig({ CF_PAGES_API_TOKEN: 't' })).toBeNull()
    expect(pagesConfig({ CF_PAGES_API_TOKEN: 't', CF_ACCOUNT_ID: 'a' })).toEqual({
      token: 't',
      accountId: 'a',
      project: 'medoflow',
    })
  })
})
