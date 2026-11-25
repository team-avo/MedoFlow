# ADR 0005 — Clinic subdomains, custom domains and host routing (B8.2)

**Status:** Accepted by engineering, implemented; DNS cut-over is an owner step · 2026-10-20 · **Deciders:** CTO (Khush), Security Officer · **Signature:** pending (below) · **Related:** [ADR 0001](0001-phi-hosting.md), [ADR 0004](0004-clinic-site-platform-and-templates.md), `arh-agent-docs/cloudflare-custom-domains-setup-guide.md` (setup steps), development plan D1.3 / B0.6.9 → B8.2

## Context

Today the app runs at `medoflow-web.advertout-medoflow.workers.dev` and the API at `medoflow-backend-6pd5.onrender.com`. B8.2 asks for three things:

- the app and API on their own domains with valid TLS, minimum TLS 1.2 and HSTS;
- a clinic subdomain **or** a clinic's own domain that renders that clinic's branded site;
- `CORS_ORIGIN`, `FRONTEND_URL` and `BACKEND_URL` moved to the new domains.

The design has to hold for thousands of clinics, so adding a clinic must not mean a deploy, a wrangler change or a hand-made DNS record.

| Risk                                                                         | Consequence if ignored                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| One Worker / route / DNS record per clinic                                   | Hits plan caps (100 Workers, 100 custom domains per zone) and needs a deploy per clinic  |
| Trusting a client-supplied host (`X-Forwarded-Host`) or an unverified domain | Anyone can point a domain at us and impersonate a clinic, or read its draft through CORS |
| CORS opened with a broad wildcard                                            | `https://evil-medoflow.com` or `a.b.medoflow.com` gets credentialed API access           |
| Several URLs per site (subdomain, custom domain, `/s/…`) all indexable       | Duplicate content; the clinic's own domain never ranks                                   |
| `workers.dev` accepts TLS 1.0/1.1 (measured)                                 | Fails the TLS 1.2 minimum                                                                |

## Decision

### 1. One Worker, a wildcard route, the host decides (no per-clinic deploys)

- The existing `medoflow-web` Worker serves every host:
  - `app.<root>` through a Workers Custom Domain;
  - `*.<root>` through a proxied wildcard DNS record plus the route `*.<root>/*`;
  - clinic domains through **Cloudflare for SaaS** custom hostnames, with the fallback origin `sites.<root>` and a `*/*` route.
- `api.<root>` is a CNAME to Render, outside the Worker.
- **A clinic subdomain is a `SiteDomain` row.** It is created at signup from the clinic slug, or on first use.
- **A clinic domain is an API call:**
  - `DOMAIN_PROVIDER=cloudflare` calls the Custom Hostnames API to create, poll and delete it;
  - `DOMAIN_PROVIDER=manual` (local, staging) checks a `_medoflow-verify` TXT record and the CNAME itself.
- Wrangler can't create custom hostnames and doesn't need to. Per-clinic wrangler `custom_domain` entries and Workers for Platforms were rejected: they cap out or cost more without benefit. The setup guide describes the chosen zero-cost set-up (one Pages branch deployment per clinic).

### 2. Host classification, mirrored and tested

`classifyHost` exists in `backend/src/site/routing/hosts.ts` and `frontend/lib/site/host.ts`, and runs on shared cases (`site-routes.json` › hosts):

| Mode             | Examples                                                                   | Served                                               |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `app`            | `app.<root>`, `localhost`, `*.workers.dev` (`APP_HOSTS`)                   | Dashboard, auth, and the path fallback `/s/<slug>/…` |
| `api`            | `api.<root>`                                                               | never a site                                         |
| `site-subdomain` | `<label>.<root>` (one label, not reserved)                                 | that clinic's site                                   |
| `site-custom`    | any other valid hostname                                                   | that clinic's site **only if verified**              |
| `invalid`        | IPs, `a.b.<root>`, reserved labels (`www`, `admin`, `sites`, …), malformed | 404                                                  |

- **Only the `Host` header is used**, never `X-Forwarded-Host`.
- The API resolves a host to a clinic (`resolveHost`, cached 60 s, invalidated on every domain change):
  - unknown or unverified hosts are `unknown` → 404 with `noindex`;
  - verified non-primary hosts are `alias` → 301/308 to the primary.

### 3. Exactly one canonical origin per site

- A site's canonical origin is its **primary** `SiteDomain`: the subdomain until the clinic makes a verified custom domain primary.
- Every other address (the subdomain, other domains, `/s/<slug>` on the app host, legacy `/clinic/<id>` URLs) redirects there.
- Canonical tags, OpenGraph URLs, the sitemap and `robots.txt` all use that origin.
- Until `SITE_ROOT_DOMAIN` is set (the state today), sites live at `<app>/s/<slug>`. Turning subdomains on is an environment change only.

### 4. Edge routing in the frontend

`middleware.ts` applies `decideEdgeRoute` (pure and unit-tested):

- On a clinic host, site paths rewrite to the internal tree `/clinic-site/<host>/<path>`.
  - Patient flows (`/checkout`, `/payment`, `/account`, `/book/<id>?clinicId=…`) stay on the clinic host.
  - Staff routes (`/dashboard`, `/login`, …) go to the app host with a 307.
- On the app host, `/s/<slug>/…` rewrites to `/clinic-site/~<slug>/…`.
- `/clinic-site/*` requested directly is a 404.
- First-builder URLs `/clinic/<id>[/store|/p/<slug>]` get a **308** at the edge, not from a page. A page redirect behind a loading boundary streams as 200 and loses its SEO value.

### 5. CORS: exact entries, single-label wildcards, verified domains

- `CORS_ORIGIN` accepts exact origins and `https://*.<root>`. A wildcard matches **one** DNS label over the same scheme, so these are refused:
  - `https://a.b.<root>`;
  - `https://evil-<root>`;
  - `http://x.<root>` when the wildcard says https.
- A clinic's custom domain is allowed **only over https and only once verified**, by a cached `resolveHost` lookup.
- The old "any `*.vercel.app`" allowance was removed.

### 6. Transport security

- **Edge (Cloudflare zone):**
  - SSL mode Full (strict);
  - Minimum TLS 1.2;
  - Always Use HTTPS;
  - HSTS of 12 months with includeSubDomains;
  - Preload off at first.
- **Apps:**
  - The API (helmet) and the Worker (`cf-worker.js`) send `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
  - Production URLs in the environment must be https; validated at boot.
  - `TRUST_PROXY` is the number of proxy hops: 1 behind Render, 2 if `api` is also proxied by Cloudflare. Rate limits and failed-login counts then see the real client IP.
- `REFRESH_COOKIE_SAMESITE` stays `none` (`Secure; Partitioned`). Patients sign in on clinic domains that are different _sites_ from the API.
- `backend/scripts/check-domain-posture.ts` produces the evidence: TLS 1.0/1.1 refused, 1.2/1.3 valid, HSTS ≥ 1 year, http → https, optional CORS preflight.

## Consequences

- **+** A new clinic is live at `<slug>.<root>` with no deploy and no DNS change. A clinic's own domain is self-service (records shown in the builder, then Verify) and costs nothing for the first 100.
- **+** Nobody can serve a clinic's site, or get CORS access, from a domain that clinic hasn't verified.
- **+** One canonical URL per site, so search engines index the clinic's chosen domain.
- **−** Clinic sites share the Worker's Free-plan quota (100k requests/day, 10 ms CPU). Real traffic needs Workers Paid; see the setup guide (limits at the top).
- **−** Bare (apex) clinic domains need CNAME flattening at the clinic's DNS provider. Otherwise the clinic uses `www` with an apex redirect; apex proxying is Enterprise-only.
- **−** `DOMAIN_PROVIDER=manual` verifies ownership but issues no certificate. Production must use `cloudflare`.
- **−** Local development quirk: the Next dev server shortens a redirect to `localhost:3000` into a relative path, so `<clinic>.localhost:3000/dashboard` redirects to itself locally. Production is unaffected, because the app host differs from the clinic host.
- **No domain yet (2026-10-22).** MedoFlow owns no domain and has no budget. Until it does, the app is served from a free Pages front door (`medoflow.pages.dev`, which refuses TLS < 1.2) that hands requests to the Worker over a service binding. Clinic sites use `/s/<slug>`, optional per-clinic Pages branch hosts, or clinic-owned domains added to the Pages project (100 free). The host-routing design above is unchanged: `SITE_ROOT_DOMAIN=medoflow.pages.dev` works like any root domain. The wildcard route and Cloudflare for SaaS parts take effect once a domain is bought.
- **Owner steps:** front door, environment cut-over and `check-domain-posture` now (setup guide Steps 1–10; walkthrough §6); zone, DNS, routes and Cloudflare for SaaS later, once a domain is bought.

## Addendum (2026-11-17, CTO-38): `pages` provider and guided connect

**Why:** with no domain owned, `DOMAIN_PROVIDER=manual` checks DNS but issues no certificate. A clinic domain that CNAMEs to `medoflow.pages.dev` without being added to the Pages project gets a Cloudflare 522. CTO-38 also asks for a Shopify / Wix style connect flow.

**Decision:**

1. **A third provider, `DOMAIN_PROVIDER=pages`.**
   - Each clinic domain is added to the `medoflow` Pages project with the Pages custom-domains API (`POST/GET/PATCH/DELETE /accounts/:acct/pages/projects/:project/domains`).
   - The clinic CNAMEs its host to `<project>.pages.dev`, and Cloudflare issues the certificate.
   - The project's production front door hands the request to the app Worker, where `classifyHost` sees `site-custom` and serves the clinic's verified domain. No routing change was needed.
   - It reuses `CF_PAGES_API_TOKEN` (Pages · Edit) and `CF_ACCOUNT_ID`. The limit is 100 domains per project on Free. Cloudflare's "limit reached" answer becomes `503 site_domain_capacity` plus an e-mail to the platform team.
2. **Ownership stays ours.** The `_medoflow-verify` TXT must be present before a domain is `VERIFIED` under every provider, so a clinic can't claim a hostname it doesn't control.
3. **Root domains are refused under `pages`.** Pages needs the zone on Cloudflare for an apex, so the API returns `422 site_domain_apex` and the UI offers "Add www.<domain> instead" plus provider-specific forwarding steps.
4. **Stages.** `SiteDomain.stage` is `dns → verified → ssl → live` (or `error`).
   - `live` needs an HTTPS probe of `/robots.txt` to pass: a valid certificate plus the Worker's HSTS header.
   - Primary needs `live` (except under `manual`), so aliases never 301 to a broken HTTPS origin.
5. **Checks run three ways:**
   - the screen polls `GET /site/domains/:id/status`, throttled to one real check per 15 s;
   - a cron re-checks domains still connecting every 5 minutes, and live ones daily;
   - the owner presses **Check now**.

   Background checks never downgrade a verified domain: drift is recorded and shown, and only a person can un-verify. Audit rows are written on stage changes only.

6. **Diagnostics.**
   - The zone is found from NS records (no public suffix list) and the DNS provider from the name servers.
   - Each record gets a plain-language result: CNAME pointing elsewhere, an A record instead of a CNAME, a missing or wrong TXT, a Cloudflare-proxied record, and CAA records that block the CA.
7. **Domain Connect** (synchronous flow) is built but dormant until `DOMAIN_CONNECT_PROVIDER_ID` is set and DNS providers onboard the template in `docs/domain-connect/`.
   - Discovery fetches a host named in the clinic's own DNS, so it goes through an SSRF guard: https only, no IP literals, public addresses only, no redirects, a 5 s timeout and a 32 KB cap.
   - Apply URLs are RS256-signed. The return carries an HMAC `state` bound to the domain.

**Consequences:**

- **+** Clinic domains get HTTPS today at no cost.
- **+** Owners see what is wrong with each record, in their provider's words.
- **−** No apex domains under `pages`.
- **−** 100 domains per project on Free.
- **−** Pages custom domains are Cloudflare-managed. The TLS minimum on external-DNS hostnames must be checked with `check-domain-posture` on a real domain (owner step).
- **−** One-click connect waits on provider onboarding and a MedoFlow-owned domain for the signing key.

Evidence: `backend/src/tests/domainDiagnose.test.ts`, `pagesDomainProvider.test.ts`, `domainConnect.test.ts`, `integration/siteDomainConnect.int.test.ts`; `frontend/tests/components/domainConnect.test.tsx`; `frontend/e2e/site-builder.spec.ts`. Walkthrough: `development-log-docs/cto-38-guided-domain-connect-WALKTHROUGH-AND-VERIFICATION.md`.

## Evidence

- Unit:
  - `backend/src/tests/siteRouting.test.ts`: host modes, CORS matcher, domain providers with stubbed DNS and stubbed Cloudflare API;
  - `frontend/tests/unit/siteRouting.test.ts`: host parity, edge routing, legacy redirects.
- Integration: `backend/src/tests/integration/siteDomains.int.test.ts`:
  - subdomains, custom domains (plan lock, 409, 422, verify, primary, alias);
  - CORS preflights, HSTS, `trust proxy`;
  - addresses at signup.
- Live end to end: `frontend/e2e/live-site.spec.ts` over `http://<slug>.localhost` (real API, real 404/308).
- Baseline posture of today's hosts: walkthrough §4.5.

## Addendum (2026-11-25): own root domain `medoflow.com`

Once MedoFlow owns `medoflow.com`, the app moves off the free `*.pages.dev`
addresses. See `arh-agent-docs/medoflow-com-domain-migration-guide.md`.

- **Front door → Worker route.** Cloudflare Pages cannot serve a wildcard custom
  domain. The app already runs as the Worker `medoflow-web`, so the apex
  `medoflow.com` (a Workers Custom Domain) and `*.medoflow.com` (a Worker route,
  `frontend/wrangler.jsonc`) go straight to that Worker. No per-clinic Pages
  branch deploy is needed: `SITE_LAUNCH_MODE=wildcard` makes `siteLaunchService`
  report a subdomain live without calling Cloudflare.
- **Pages project kept.** The `medoflow` Pages project still serves
  `medoflow.pages.dev`, any old branch deployments, and — crucially — every clinic
  **custom** domain added through `DOMAIN_PROVIDER=pages` (those still CNAME to
  `medoflow.pages.dev`, which is why `SITE_CNAME_TARGET` stays `medoflow.pages.dev`).
- **Legacy redirects.** `cf-worker.js` runs `retiredHostRedirect` first: when
  `LEGACY_ROOT_DOMAINS` is set it 308s `medoflow.pages.dev` and
  `<label>.medoflow.pages.dev` to the matching `medoflow.com` address (method,
  body, path and query preserved). Empty var ⇒ no-op, so the change is dormant
  until cut-over.
- **API.** `api.medoflow.com` is a Render custom domain, DNS-only (grey) so the
  Worker never runs for it; `api.<root>` already classifies as `api` in
  `classifyHost`.
- **Cookies.** The app and API are now sibling subdomains of one registrable
  domain, so `REFRESH_COOKIE_SAMESITE=strict` becomes an option (B0.6.9); `none`
  is kept for now.

Evidence: `frontend/tests/unit/retiredHostRedirect.test.ts`;
`backend/src/tests/integration/siteLaunch.int.test.ts` (wildcard mode).

## Sign-off

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| CTO              |      |      |           |
| Security Officer |      |      |           |
