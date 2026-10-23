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

## Sign-off

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| CTO              |      |      |           |
| Security Officer |      |      |           |
