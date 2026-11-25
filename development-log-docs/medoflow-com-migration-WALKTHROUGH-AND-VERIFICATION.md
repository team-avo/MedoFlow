# medoflow.pages.dev → medoflow.com migration — Part B (code) walkthrough

Date: 2026-11-25 · Branch: `development` (changes left **uncommitted** for review) ·
Operator guide (manual steps): `arh-agent-docs/medoflow-com-domain-migration-guide.md`

## 1. Outcome

Code to move the product off the free Cloudflare addresses onto the owned domain
`medoflow.com`, done so that **merging the diff changes nothing for users** until
the operator flips the cut-over env values:

- the app Worker now binds `medoflow.com` (apex) and `*.medoflow.com` (wildcard),
  so every clinic subdomain is served by one Worker route with no per-clinic deploy;
- old addresses (`medoflow.pages.dev`, `<label>.medoflow.pages.dev`, the `workers.dev`
  address) 308-redirect to the matching `medoflow.com` address — **dormant until the
  `LEGACY_ROOT_DOMAINS` Worker var is set**;
- the backend stops attempting a per-clinic Cloudflare Pages deploy when
  `SITE_LAUNCH_MODE=wildcard`, reporting the address live immediately;
- config, env examples, Domain Connect template and ADR 0005 updated.

The Pages project `medoflow` is deliberately kept: it still serves
`medoflow.pages.dev`, old branch deployments, and every clinic **custom** domain
(`DOMAIN_PROVIDER=pages`, which still CNAMEs to `medoflow.pages.dev`).

## 2. What changed (files)

**Frontend / Worker**

- `frontend/wrangler.jsonc` — live `routes`: `medoflow.com/*` + `*.medoflow.com/*`, both zone **routes** (not a custom domain: the apex already has a proxied DNS record, which a `custom_domain` refuses — Cloudflare 100117). The apex route also preempts any leftover apex→www origin forwarding. Each needs a proxied DNS record (e.g. AAAA `100::`).
- `frontend/lib/site/retiredHostRedirect.ts` (**new**) — pure `retiredHostRedirect(url, env)` returning a 308 Response or null. Named to avoid the existing `legacyRedirect.ts` (per-clinic `/clinic/*` URL moves).
- `frontend/cf-worker.js` — runs `retiredHostRedirect` first, before the HTTPS/HSTS logic.
- `frontend/tests/unit/retiredHostRedirect.test.ts` (**new**) — 14 tests.
- `frontend/.env.example` — apex production examples.

**CI**

- `.github/workflows/deploy.yml` — passes `--var LEGACY_ROOT_DOMAINS --var SITE_ROOT_DOMAIN` to `wrangler deploy`; `FRONTEND_URL` fallback and header comments → `medoflow.com`; smoke test asserts the legacy 308 when the var is set.
- `.github/workflows/front-door.yml`, `front-door-all.yml`, `frontend/cf-front-door/functions/[[path]].js` — comments mark them legacy (kept for `medoflow.pages.dev` + clinic custom domains).

**Backend**

- `backend/src/site/config.ts` — `siteLaunchMode()` (`pages` default | `wildcard`).
- `backend/src/site/services/siteLaunchService.ts` — wildcard short-circuit in `requestLaunch`/`launchStatus` (LIVE at `https://<label>.medoflow.com`, no Cloudflare call, no `SiteLaunch` row).
- `backend/src/tests/integration/siteLaunch.int.test.ts` — new wildcard-mode test.
- `backend/src/controllers/authController.ts` — refresh-cookie comment updated.
- `backend/.env.example` — `SITE_LAUNCH_MODE`, apex `APP_HOSTS` note.

**Config / docs**

- `render.yaml` — `CORS_ORIGIN`/`FRONTEND_URL`/`APP_URL` → `medoflow.com`; added `BACKEND_URL`, `SITE_ROOT_DOMAIN`, `APP_HOSTS`, `SITE_LAUNCH_MODE`; cut-over comment rewritten.
- `docs/domain-connect/medoflow.example.clinic-site.json` — `syncRedirectDomain` → `medoflow.com` (the CNAME `%target%` stays `medoflow.pages.dev`).
- `docs/adr/0005-custom-domains-and-host-routing.md` — "own root domain" addendum.

## 3. Design notes

- **Why a Worker route, not Pages:** Cloudflare Pages can't serve a wildcard custom domain; the app already runs as the `medoflow-web` Worker, so apex + wildcard go straight to it. `classifyHost` already maps the apex to `app`, `<label>.<root>` to `site-subdomain`, and `api.<root>` to `api`, so no routing code changed.
- **Why `SITE_LAUNCH_MODE` is an explicit toggle, not "root ≠ pages.dev":** the integration tests run under `SITE_ROOT_DOMAIN=site.test`; a heuristic on the root string would silently flip every existing CTO-26 launch test to wildcard. An explicit var (default `pages`) keeps all existing behaviour and tests unchanged until cut-over.
- **Dormant by default:** `retiredHostRedirect` returns null while `LEGACY_ROOT_DOMAINS` is empty, and the Worker `routes` only bind once the `medoflow.com` zone is Active and the deploy token has Zone Read + Workers Routes Edit. So the diff is safe to merge ahead of the manual steps.
- **308, not 301/302:** preserves method and body, so a form POST or API call to an old address still works.
- **Fallback hosts:** a reserved label, a Pages preview-hash host, or a multi-label host under an old root redirects to the app root host (path kept), never to a fabricated clinic subdomain.

## 4. Verification (local)

Run on `development` (fast-forwarded to `origin/development` `7c78872`):

| Gate                                                     | Result                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| Backend `tsc --noEmit`                                   | ✅ (includes the new integration test file)                 |
| Backend ESLint (changed files)                           | ✅                                                          |
| Backend unit suite                                       | ✅ 762 passed (47 files)                                    |
| Frontend `tsc --noEmit`                                  | ✅                                                          |
| Frontend ESLint (changed files)                          | ✅                                                          |
| Frontend unit + `siteBuilder`/`domainConnect` components | ✅ 487 passed (31 files), incl. `retiredHostRedirect` 14/14 |
| `node scripts/check-no-em-dash.js`                       | ✅ "No em dashes in 884 files."                             |
| `node --check frontend/cf-worker.js`                     | ✅                                                          |

**Not runnable in this environment (no local Postgres / Docker / gitleaks binary):**

- Backend **integration** suite (`vitest.integration.config.ts`) — needs `INTEGRATION_DATABASE_URL` + `INTEGRATION_ADMIN_DATABASE_URL`. The new wildcard test type-checks; run it in CI or against a local `mf_it`.
- **Playwright** e2e (needs the running app).
- **gitleaks** (Docker image `zricethezav/gitleaks`).

## 5. What the operator must do (Part A/C)

All manual steps are in `arh-agent-docs/medoflow-com-domain-migration-guide.md`:
Cloudflare zone + DNS, GoDaddy nameservers, the Render `api.medoflow.com` custom
domain, the deploy-token zone permissions, and the cut-over env values — which now
include **`SITE_LAUNCH_MODE=wildcard`** and **`LEGACY_ROOT_DOMAINS`** (GitHub var)
and the matching Render values. Part C verification (curl + `check-domain-posture`)
is run at cut-over and its evidence pasted back here.

## 6. Known limits / pending

- Integration + e2e + gitleaks not run locally (above); rely on CI.
- Pages custom-domain TLS minimum on external DNS is still an owner check with `check-domain-posture` (carried over from CTO-38 / ADR 0005).
- `REFRESH_COOKIE_SAMESITE` kept at `none`; `strict` becomes an option now that app + API share `medoflow.com` (future B0.6.9).
