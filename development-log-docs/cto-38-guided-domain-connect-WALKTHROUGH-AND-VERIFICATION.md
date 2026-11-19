# CTO-38 Guided custom-domain connect: walkthrough and verification

**Date:** 2026-11-17 · **Branch:** `feat/cto-38-guided-domain-connect` (from `development` at `a028515`; commits `96efff3`, `ac554b6` and this doc; not pushed) · **Data:** synthetic only · **Plan reference:** CTO-38 in `arh-agent-docs/cto-feedback-tasks.md`, B8.10 / F8.8 in `arh-agent-docs/development-plan.md` · **Machine:** macOS, zsh, Node 22, Docker Desktop (`mf-pg`).

**Trigger:** in the 2026-11-11 demo, Khush asked for a Shopify / Wix style way to connect a clinic's own domain. Before this branch, the Domains screen showed a generic CNAME + TXT table and a manual **Verify** button. Production also runs `DOMAIN_PROVIDER=manual`, which checks DNS but issues no certificate. A clinic domain pointed at `medoflow.pages.dev` without being added to the Pages project gets a Cloudflare 522, so a clinic domain could never serve over HTTPS on today's zero-cost setup.

**Owner decisions (2026-11-16 / 17):**

- **HTTPS route:** a new `pages` domain provider. Each clinic domain is added to the `medoflow` Cloudflare Pages project, which is free, allows 100 domains per project, and issues the certificate.
- **Domain Connect (AC3):** build the full flow, but keep it dormant until it is configured and DNS providers onboard the template.
- **Real domain (AC4):** the owner has no test domain to give right now. Everything is built and tested with stubs; the real run is §6, step 3.

---

## 1. Outcome

| AC  | What it asks                                                                                                                             | Status            | Evidence                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Detect the DNS provider; show the exact records with copy buttons; instructions for GoDaddy, Namecheap, Cloudflare, Google / Squarespace | ✅                | NS-based detection (`diagnose.ts`); per-provider guides (`dnsProviderGuides.ts`); zone-relative hosts (`www`, `_medoflow-verify.www`) with copy buttons and a DNS-settings deep link; unit, component and e2e tests |
| 2   | Verification polled automatically; live status pending → verified → SSL → live; clear errors like "CNAME points to X, expected Y"        | ✅                | `SiteDomain.stage`; `GET /site/domains/:id/status` (throttled); 5-minute cron; per-record diagnostics; e2e `dns → verified → ssl → live with no clicks`                                                             |
| 3   | One-click "Connect automatically" where the registrar supports Domain Connect                                                            | 🟨 built, dormant | discovery + template check + RS256-signed apply URL + signed return; template in `docs/domain-connect/`; works only once MedoFlow owns a domain and providers onboard the template (§6, step 4)                     |
| 4   | A test domain resolves, serves over HTTPS, and `check-domain-posture` passes                                                             | ⬜ owner step     | needs a real domain (§6, step 3). Not run: the owner said on 2026-11-17 that no domain will be provided now                                                                                                         |

What the clinic owner now sees on **Website → Domains → Your own domain**:

1. They enter `www.theirclinic.com`. A root domain such as `theirclinic.com` is refused with **Add www.theirclinic.com instead**.
2. "We detected **GoDaddy** manages DNS for theirclinic.com" appears, with **Open GoDaddy DNS settings** and numbered steps in GoDaddy's own words.
3. They see two records with copy buttons, named the way the provider asks for them, each with a live ✓ / ✗ and a reason. For example: "CNAME www.theirclinic.com points to parked.godaddy.com, expected medoflow.pages.dev".
4. A stepper (**DNS records → Verified → HTTPS certificate → Live**) moves by itself. The screen checks every 10 s, then every 30 s after 10 minutes, and stops after 30 minutes with **Check again**. The server also re-checks every 5 minutes, so the owner can leave the page.
5. Once the domain is live, they can press **Make primary**. They also get a tip on forwarding the root domain at their provider.

## 2. Problems found (root causes)

1. **No HTTPS for clinic domains on the current setup.** `manual` only checks DNS. Cloudflare serves a hostname on a Pages project only after it is added to that project, and the old `cloudflare` provider (Cloudflare for SaaS) needs a zone MedoFlow doesn't own.
2. **Records were shown as full names only.** GoDaddy, Namecheap and most other providers want `www`, not `www.clinic.com`, and owners pasted the full name, creating `www.clinic.com.clinic.com`.
3. **One generic error at a time.** The manual check reported the first problem only ("must be a CNAME to …"). It never said _what_ DNS answered (an A record, a parking page, an orange-clouded record) or that CAA records were blocking the certificate.
4. **"Verified" was the end state.** Nothing tracked whether the certificate was issued or the site actually answered. **Make primary** was allowed as soon as DNS matched, so every other address could 301 to an origin with no certificate yet.
5. **Every check was manual and audited.** Polling on the old route would have written an audit row each time.

## 3. What changed (files)

### Backend

| Area                   | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DNS diagnostics        | [diagnose.ts](../backend/src/site/domainProvider/diagnose.ts): `findZone` (NS walk-up, skips CNAME levels, no public suffix list); `detectDnsProvider` (GoDaddy, Namecheap, Cloudflare, Squarespace / Google, Route 53, IONOS, Wix, other); `checkRecords` (TXT missing or different, CNAME elsewhere, A instead of CNAME, Cloudflare-proxied, flattened apex accepted, CAA); `relativeHost`; a 2.5 s resolver with a test seam                                                      |
| `pages` provider       | [pages.ts](../backend/src/site/domainProvider/pages.ts): add, fetch, re-validate (`PATCH`, at most every 10 minutes) and delete the domain on the Pages project; idempotent register; capacity detection. Ownership TXT is still required                                                                                                                                                                                                                                            |
| Shared Cloudflare call | [cfApi.ts](../backend/src/site/frontDoor/cfApi.ts): `cfCall`, `PagesError`, `pagesConfig`, used by both the CTO-26 launcher ([pagesClient.ts](../backend/src/site/frontDoor/pagesClient.ts)) and the provider                                                                                                                                                                                                                                                                        |
| HTTPS probe            | [probe.ts](../backend/src/site/domainProvider/probe.ts): `GET https://<host>/robots.txt`, no redirects followed, 5 s; live = 200 / 301 / 308 **and** the Worker's HSTS header                                                                                                                                                                                                                                                                                                        |
| Provider wiring        | [types.ts](../backend/src/site/domainProvider/types.ts) (`RecordCheck`, `DnsRecord.host`, `'pages'`), [index.ts](../backend/src/site/domainProvider/index.ts), [manual.ts](../backend/src/site/domainProvider/manual.ts) (now uses `checkRecords`), [config.ts](../backend/src/site/config.ts) (`DOMAIN_PROVIDER=pages`; the CNAME target defaults to `<project>.pages.dev`), [envValidation.ts](../backend/src/config/envValidation.ts) (`pages` needs the Pages token and account) |
| Stages and checks      | [domainService.ts](../backend/src/site/services/domainService.ts): `refreshDomain` (sources `poll` / `manual` / `cron`, 15 s poll throttle, stage machine, audits on stage change only, background never un-verifies), `domainStatus`, `recheckDomains`, root-domain refusal under `pages`, capacity alert, primary only when `live`, best-effort provider removal, `removeProviderDomains` (off-boarding)                                                                           |
| Domain Connect         | [domainConnect/index.ts](../backend/src/site/domainConnect/index.ts) (config, discovery, template check, 10-minute cache, signed apply URL, HMAC `state`); [domainConnect/safeFetch.ts](../backend/src/site/domainConnect/safeFetch.ts) (SSRF guard)                                                                                                                                                                                                                                 |
| Routes                 | [domains.routes.ts](../backend/src/site/http/admin/domains.routes.ts): `GET /:id/status`, `GET /:id/connect`, `POST /:id/connect/return` (owner-only, like the rest)                                                                                                                                                                                                                                                                                                                 |
| Background             | [cronJobs.ts](../backend/src/scheduler/cronJobs.ts): `cron:domain-recheck` every 5 minutes (connecting domains, last 14 days, 50 per tick) and daily (live domains, drift)                                                                                                                                                                                                                                                                                                           |
| Off-boarding           | [dataLifecycleService.ts](../backend/src/services/dataLifecycleService.ts): removes each clinic's custom domains from the provider                                                                                                                                                                                                                                                                                                                                                   |
| Alerts                 | [platformAlert.ts](../backend/src/site/services/platformAlert.ts) (shared recipients, now also used by the CTO-26 launcher), [emailService.ts](../backend/src/services/emailService.ts) `sendDomainCapacityEmail`                                                                                                                                                                                                                                                                    |
| Schema                 | migration `20261117090000_site_domain_guided_connect`: `SiteDomain.stage` (default `dns`), `dnsProvider`, `zone`, `checks` (JSONB), `liveAt`, `lastRetryAt`, index `(kind, stage)`. Additive. Existing subdomains backfill to `live`; verified custom domains backfill to `verified`                                                                                                                                                                                                 |

### Frontend

| Area            | Files                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API types       | [siteApi.ts](../frontend/lib/site/siteApi.ts): `stage`, `zone`, `dnsProvider`, `checks`, `DnsRecord.host`, `DomainConnectInfo`; `getDomainStatus`, `getDomainConnect`, `domainConnectReturn`                                                                                                           |
| Provider guides | [dnsProviderGuides.ts](../frontend/lib/site/dnsProviderGuides.ts): GoDaddy, Namecheap, Cloudflare, Squarespace (Google Domains), Route 53, IONOS, Wix and a generic guide. Each has field names, steps, notes (DNS only, no quotes, …), a DNS-settings link and root-domain forwarding                 |
| Connect card    | [DomainConnectCard.tsx](../frontend/components/site/domains/DomainConnectCard.tsx): stepper, status pill, detected-provider guide, records table with per-record ✓ / ✗, polling (10 s, 30 s, stop at 30 minutes, then "Check again"), toasts on stage changes, "Connect automatically", forwarding tip |
| Domains page    | [domains/page.tsx](../frontend/app/dashboard/site/domains/page.tsx): uses the card; patches poll results into the list; **Add www instead** on a root-domain refusal; handles the Domain Connect return (`?dc=<id>&state=…[&error=…]`) and cleans the URL                                              |

### API at a glance

| Call                                                             | Who   | Does                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/site/domains` `{hostname}`                         | owner | adds the domain; detects the zone and DNS provider; `422 site_domain_apex` for a root domain under `pages`; `503 site_domain_capacity` when the Pages project is full |
| `GET /api/v1/site/domains/:id/status`                            | owner | one real check per 15 s per domain, otherwise the stored state                                                                                                        |
| `POST /api/v1/site/domains/:id/verify`                           | owner | checks now (the **Check now** button); audited as before                                                                                                              |
| `GET /api/v1/site/domains/:id/connect`                           | owner | `{available:false, reason}` (`not_configured`, `not_supported`, `template_missing`, `unreachable`, `not_needed`) or `{available:true, providerName, url}`             |
| `POST /api/v1/site/domains/:id/connect/return` `{state, error?}` | owner | checks the HMAC `state` (400 `site_connect_state` otherwise), audits, re-checks at once                                                                               |
| `POST /api/v1/site/domains/:id/primary`                          | owner | now `409 site_domain_not_live` until the domain is live (except under `manual`)                                                                                       |

### Docs

- [ADR 0005](../docs/adr/0005-custom-domains-and-host-routing.md): "Addendum (2026-11-17, CTO-38)".
- [docs/domain-connect/](../docs/domain-connect/): the template (`medoflow.example.clinic-site.json`, placeholder provider id) and the onboarding README.
- `render.yaml` comments, `backend/.env.example` (`pages`, `DOMAIN_CONNECT_*`).
- `arh-agent-docs/cloudflare-custom-domains-setup-guide.md`: Step 11 (clinic-owned domains), a day-to-day row (gitignored).
- `arh-agent-docs/cto-feedback-tasks.md` and `development-plan.md`: CTO-38 🟨, new B8.10 / F8.8 (gitignored).

## 4. Verification: commands and results

### 4.1 Gates (the same steps as `.github/workflows/deploy.yml`)

```zsh
cd backend  && pnpm run typecheck && pnpm run lint && pnpm run test
cd backend  && INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it \
               INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it \
               pnpm run test:integration
cd frontend && pnpm run typecheck && pnpm run lint && pnpm run test
cd frontend && npx playwright test            # production build, mocked API
node scripts/check-no-em-dash.js
gitleaks detect --no-banner --redact --source .
```

Results on 2026-11-17 / 18 (this machine):

| Gate                                                                | Result                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend typecheck (`tsc` app + tests)                               | ✅ exit 0                                                                                                                                                                                                                                                                                                            |
| Backend lint (`--max-warnings=0`)                                   | ✅ exit 0                                                                                                                                                                                                                                                                                                            |
| Backend unit                                                        | ✅ 43 files, **660 passed**                                                                                                                                                                                                                                                                                          |
| Backend integration (Postgres `mf_it`, `medoflow_app`, RLS on)      | ✅ 28 files passed + 1 skipped; **375 passed, 1 skipped**                                                                                                                                                                                                                                                            |
| Frontend typecheck (`next typegen && tsc`)                          | ✅ exit 0                                                                                                                                                                                                                                                                                                            |
| Frontend lint (`--max-warnings=0`)                                  | ✅ exit 0                                                                                                                                                                                                                                                                                                            |
| Frontend unit + component                                           | ✅ 52 files, **616 passed**                                                                                                                                                                                                                                                                                          |
| Playwright, full suite (production build, mocked API)               | first run: 91 passed, 11 failed, 16 skipped in **4.1 h** at load average 10–16. Every failure was a timeout or "page closed" in `layout-smoke` (all roles, including the public landing page) and one `waitlist-recurring` test. One test showed a 1 h wall time against a 240 s timeout, so the machine was stalled |
| Playwright, those two files again at lower load                     | ✅ **29 passed** (`layout-smoke` 27/27, which visits `/dashboard/site/domains`; `waitlist-recurring` 2/2). Full suite total: **102 passed, 16 skipped, 0 failing**                                                                                                                                                   |
| Playwright, `site-builder.spec.ts` (contains both new domain tests) | ✅ 8 passed                                                                                                                                                                                                                                                                                                          |
| Em-dash guard                                                       | ✅ "No em dashes in 833 files."                                                                                                                                                                                                                                                                                      |
| gitleaks v8.21.2 (Docker) over `development..HEAD`                  | ✅ 2 commits scanned, no leaks                                                                                                                                                                                                                                                                                       |

Before the integration run, the local `medoflow_app` role password had drifted from the documented `app_local_pw`. It was reset (§9.2 note), and no test or code changed for it.

### 4.2 New tests

| Suite                                                         | Tests             | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/tests/domainDiagnose.test.ts`                    | 25                | zone walk-up (`www.clinic.co.uk`), skipping a CNAME level; 10 name-server → provider cases; zone-relative names; the `pages` CNAME target; every record message (TXT missing, TXT different, CNAME elsewhere, A instead of CNAME, orange cloud, none at all); flattened apex; CAA blocking (inherited) and allowed                                                                                                                                                                                                                                                                                               |
| `backend/src/tests/pagesDomainProvider.test.ts`               | 10                | add (exact URL and body); idempotent register (409 → GET); capacity error; the token never appears in errors; DNS not ready → Cloudflare not called; pending, active and blocked mapping; `PATCH` retry throttled to 10 minutes; a domain missing on Cloudflare is re-added; delete with a 404 tolerated                                                                                                                                                                                                                                                                                                         |
| `backend/src/tests/domainConnect.test.ts`                     | 18                | off until configured; TXT → settings → template check; no record → no HTTP; template 404; private discovery host refused; per-zone cache; the SSRF guard (http, IP literals, credentials, port, private / loopback / link-local / CGNAT / ULA addresses, redirects, 40 KB body); apply-URL parameters; RS256 signature verified with a generated key; `state` bound to the domain; the template file creates exactly our two records                                                                                                                                                                             |
| `backend/src/tests/integration/siteDomainConnect.int.test.ts` | 13                | real Postgres, RLS on, provider behaving like `pages`: detection + relative hosts; root-domain 422; per-record poll message; poll throttle; **cron moves dns → verified → ssl → live with no clicks**; primary refused until live; stage audits once each as system rows and no `CHECK_FAILED` noise; live → primary → resolves; drift never takes a live domain offline (one `SITE_DOMAIN_DRIFT`); Domain Connect `not_configured` / not supported; signed return (400 on a bad state, re-check, audit); other clinic 404 and front desk 403 on the new routes; off-boarding removes the domain at the provider |
| `frontend/tests/components/domainConnect.test.tsx`            | 17                | guides for GoDaddy, Namecheap, Cloudflare and Squarespace (wording, steps, links); Cloudflare and Namecheap notes; generic fallback; the stepper in all 5 stages; detected provider + link + relative hosts + per-record results; **polling moves the stepper to Live with no click and then stops**; Connect button only when available; hidden when the template is missing; **Add www instead**; Domain Connect return                                                                                                                                                                                        |
| `frontend/e2e/site-builder.spec.ts`                           | 2 new (8 in file) | guided records, then dns → verified → ssl → live with no clicks (Playwright clock), Make primary; Connect automatically navigates to the provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Existing suites updated: `siteDomains.int.test.ts` (DNS and probe stubbed; all 14 still pass) and `siteBuilder.test.tsx` (the **Verify** button is now **Check now**).

### 4.3 Real domain (AC4): not run

The owner has no test domain to give yet (2026-11-17). §6, step 3 lists the exact run, and its output goes here when done:

```
(dig +short CNAME www.<domain>)             → medoflow.pages.dev.
(dig +short TXT _medoflow-verify.www.<domain>) → "medoflow-verify=<token>"
check-domain-posture www.<domain> …         → every line PASS
```

## 5. Design notes

- **Why Pages custom domains.** They are free, issue the certificate, and land on the production front door, which already hands every request to the app Worker. `classifyHost` sees `site-custom`, and `resolveHost` serves the clinic whose _verified_ domain it is (ADR 0005), so routing needed no change.
- **Ownership is ours, not Cloudflare's.** Cloudflare would validate any hostname that CNAMEs to us. Our `_medoflow-verify` TXT is still required before a domain is `VERIFIED`, so a clinic can't claim a hostname belonging to someone else.
- **Stages are computed, not trusted.** `live` needs our own HTTPS probe to pass, with a valid certificate and the HSTS header only our Worker adds. Cloudflare saying "active" alone gives `ssl`.
- **Background checks never take a site down.** DNS answers can be wrong for a minute (a resolver hiccup, a TTL). Only a person pressing **Check now** can turn a verified domain back to unverified; background drift is recorded, shown, and audited once.
- **Polling cost.** The screen polls `/status`, but the server checks at most every 15 s per domain, and the cron takes 50 domains per tick. An audit row is written only when the stage changes.
- **Zone detection without a public suffix list.** We walk up the labels and take the first name with NS records. A CNAME'd level is skipped, because an NS query on an alias can return the target's servers.
- **Domain Connect safety.**
  - The discovery host comes from the clinic's DNS, so the fetch refuses non-https URLs, IP literals, private / loopback / link-local / CGNAT / ULA addresses, redirects, and bodies over 32 KB. It times out after 5 s.
  - Apply URLs are RS256-signed once a key is configured.
  - The return needs an HMAC `state` bound to the domain id, keyed with the preview secret.
  - The template only sets the CNAME on the connected host and our TXT (`hostRequired: true`).

## 6. What you must do manually

1. **Render env, to turn the `pages` provider on.** Set these on Render → medoflow-backend → Environment, then save (Render redeploys):
   - `DOMAIN_PROVIDER=pages`
   - `SITE_CNAME_TARGET=medoflow.pages.dev`
   - `CF_PAGES_API_TOKEN` (secret): a Cloudflare token with **Account · Cloudflare Pages · Edit** only
   - `CF_ACCOUNT_ID`
   - `CF_PAGES_PROJECT=medoflow`

   The same token also turns on the CTO-26 automatic clinic addresses. The Pages project and its production front door already exist (the front-door workflow has run).

2. **Test clinic on a paid plan.** FREE allows 0 custom domains: move the test clinic to STARTER (platform admin, or `UPDATE "Tenant" SET plan='STARTER' WHERE id='<tenant>'`).
3. **AC4, the real-domain run (when a domain is available).**
   1. On the hosted app, sign in as that clinic's owner → **Website → Domains** → add `clinic-test.<your-domain>`.
   2. At your DNS provider, add the CNAME `clinic-test` → `medoflow.pages.dev` and the TXT `_medoflow-verify.clinic-test` → the value shown. If your DNS is on Cloudflare, set the CNAME to **DNS only**.
   3. Leave the screen open and watch DNS records → Verified → HTTPS certificate → Live. Record the screen.
   4. Run:
      ```zsh
      dig +short CNAME clinic-test.<your-domain>
      dig +short TXT _medoflow-verify.clinic-test.<your-domain>
      cd backend && npx ts-node --transpile-only scripts/check-domain-posture.ts clinic-test.<your-domain> \
        --cors-from https://clinic-test.<your-domain> --cors-path /api/v1/health
      ```
      Every line must say PASS. Paste the output into §4.3 and the PR.
   5. If TLS 1.0/1.1 is accepted on the clinic hostname, record it under §8. That setting belongs to Cloudflare for Pages custom domains, not to MedoFlow.
4. **Domain Connect (later, only once MedoFlow owns a domain).** Follow [docs/domain-connect/README.md](../docs/domain-connect/README.md):
   1. replace the placeholder provider id;
   2. generate an RSA key and publish the public key at `_dck1.<domain>`;
   3. set `DOMAIN_CONNECT_PROVIDER_ID`, `DOMAIN_CONNECT_SERVICE_ID`, `DOMAIN_CONNECT_KEY_HOST` and `DOMAIN_CONNECT_PRIVATE_KEY` on Render;
   4. open a PR with the template to `Domain-Connect/Templates`;
   5. ask GoDaddy, Cloudflare and IONOS to onboard it.

   Namecheap and Squarespace aren't listed as Domain Connect providers, so they keep the guided manual path.

5. **Migration.** It applies on the next Render deploy (`prisma migrate deploy`). It is additive.
6. **Merge.** Review and merge the branch, then refresh the plan tracker artifact.

## 7. HIPAA / review checklist

- [x] **No PHI touched.** Domains, DNS records and audit rows carry hostnames, record values, stages and ids only. `SiteDomain.checks` holds DNS answers, not patient data.
- [x] **Least privilege.** The Pages token (Pages · Edit) stays server-side and is never in a response or log line. Cloudflare errors carry Cloudflare's message only (a unit test checks the token never appears).
- [x] **Tenant isolation.** New routes sit behind the existing owner guard; another clinic gets 404 and front desk gets 403 (integration test). The cron runs in a named tenant bypass (`cron:domain-recheck`) over rows it owns.
- [x] **Audit.** `SITE_DOMAIN_STAGE`, `SITE_DOMAIN_LIVE`, `SITE_DOMAIN_DRIFT`, `SITE_DOMAIN_CONNECT_RETURN` and `SITE_DOMAIN_CAPACITY` are added. Background rows have `performedById = null`. Existing actions are unchanged.
- [x] **SSRF.** Domain Connect discovery is guarded (§5). The HTTPS probe only runs once the host CNAMEs to our target.
- [x] **CSRF on the provider return.** An HMAC `state`, compared in constant time.
- [x] **No secrets committed.** Gitleaks result in §4.1. The template holds a placeholder provider id and no key.

## 8. Known limits (and open items)

- **AC4 not run:** no real test domain yet (§6, step 3).
- **No root domains under `pages`:** Pages needs the zone on Cloudflare for an apex. Owners get **Add www instead** and provider-specific forwarding steps.
- **100 domains per Pages project on Free:** reaching it gives `503 site_domain_capacity` and an e-mail to the platform team.
- **Domain Connect is dormant:** it needs a MedoFlow-owned domain (signing key, provider id) and per-provider onboarding.
- **Provider deep links:** each DNS provider's settings URL is best effort. Providers change their consoles, and the steps describe what to look for, so a moved page still works.
- **DNS rebinding:** Domain Connect discovery checks addresses before the fetch, not during it. Answers are only parsed as JSON and never shown raw.
- **Usage analytics:** mapping `SITE_DOMAIN_LIVE` to a feature in `usageFeatures.ts` waits for CTO-39 (`feat/cto-39-usage-analytics`) to merge.
- **Next.js build notice:** on 2026-11-17 the first `next build` stopped with "Your version of Next.js is affected by a known security vulnerability" and suggested an upgrade. A retry built normally. The upgrade is not part of this branch; it is the owner's call (see the hand-over message).

## 9. Manual local testing guide (macOS)

### 9.1 Before you start

- Docker Desktop running, with `mf-pg` up (`docker ps` shows `mf-pg … 0.0.0.0:55432`).
- Node 22 and `pnpm install` done at the repo root.
- Internet access: the checks below look up the real DNS of `example.com` (owned by IANA and safe to test against).
- Three terminals. Locally the provider is `manual`, so nothing reaches Cloudflare.

### 9.2 One-time setup (terminal 3)

```zsh
REPO=~/Work/AdvertOut/MedoFlow
cd $REPO/backend
DB=mf_manual_cto38
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB pnpm exec prisma migrate deploy | tail -1
H() { node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" }
cat > .env.cto38.local <<EOF
# Local manual testing only (gitignored). Throwaway values.
PORT=4313
NODE_ENV=development
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_manual_cto38
CORS_ORIGIN=http://localhost:3011
FRONTEND_URL=http://localhost:3011
APP_HOSTS=localhost,127.0.0.1
JWT_SECRET=$(H)
MFA_ENCRYPTION_KEY=$(H)
FIELD_ENCRYPTION_PROVIDER=env
FIELD_ENCRYPTION_KEYS=k1:$(H)
FIELD_ENCRYPTION_ACTIVE_KID=k1
FILE_BLOB_SIGNING_SECRET=$(H)
SITE_PREVIEW_SECRET=$(H)
TENANT_ISOLATION_MODE=enforce
CLINIC_REVIEW_MODE=auto
BILLING_MODE=demo
ONBOARDING_CONFIRM_NAME=off
NPI_REGISTRY_MODE=off
AI_SCRIBE_LLM_PROVIDER=mock
AI_SCRIBE_STT_PROVIDER=mock
DOMAIN_PROVIDER=manual
SITE_CNAME_TARGET=medoflow.pages.dev
MANUAL_PASSWORD=Synthetic-Manual-$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
EOF
grep MANUAL_PASSWORD .env.cto38.local
```

**Expect:** `All migrations have been successfully applied.`, then `MANUAL_PASSWORD=Synthetic-Manual-<8 hex>`. Keep the password.

> If the backend later fails with "credentials for `medoflow_app` are not valid", reset the local role password: `docker exec mf-pg psql -U postgres -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'app_local_pw'"`. It had drifted on this machine on 2026-11-17.

### 9.3 Start the apps

```zsh
# Terminal 1: backend
cd ~/Work/AdvertOut/MedoFlow/backend && set -a && . ./.env.cto38.local && set +a && pnpm exec ts-node --transpile-only src/server.ts
#   wait for: Medoflow server running on port 4313 (development)
# Terminal 2: frontend
cd ~/Work/AdvertOut/MedoFlow/frontend && NEXT_PUBLIC_API_URL=http://localhost:4313 NEXT_PUBLIC_APP_URL=http://localhost:3011 node node_modules/next/dist/bin/next dev -p 3011
#   wait for: ✓ Ready
```

### 9.4 Backend checks (terminal 3)

zsh note: don't name a shell variable `path`, because in zsh it's tied to `PATH`.

```zsh
REPO=~/Work/AdvertOut/MedoFlow
cd $REPO/backend
set -a; . ./.env.cto38.local; set +a
API=http://localhost:4313/api/v1
CL="X-MedoFlow-Client: web"
P() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log($1)})" }
req() { local m=$1 u=$2 body=$3; curl -s -X $m -H "$CL" -H "authorization: Bearer $AT" -H 'content-type: application/json' ${body:+-d "$body"} $API$u }
code() { local m=$1 u=$2 body=$3; curl -s -o /dev/null -w '%{http_code}' -X $m -H "$CL" -H "authorization: Bearer $AT" -H 'content-type: application/json' ${body:+-d "$body"} $API$u }
RUN=$(date +%s); SUB=dom$RUN; OWNER=owner.$RUN@example.test; AT=""

curl -s -H "$CL" -H 'content-type: application/json' -d "{\"clinicName\":\"Domain Test $RUN\",\"clinicEmail\":\"clinic.$RUN@example.test\",\"subdomain\":\"$SUB\",\"ownerName\":\"Domain Owner\",\"ownerEmail\":\"$OWNER\",\"password\":\"$MANUAL_PASSWORD\",\"plan\":\"FREE\"}" $API/tenants/signup >/dev/null
AT=$(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"email\":\"$OWNER\",\"password\":\"$MANUAL_PASSWORD\"}" $API/auth/login | P 'd.data.accessToken')
echo "B-1 FREE plan: $(code POST /site/domains '{"hostname":"www.example.com"}')"
docker exec mf-pg psql -U postgres -d mf_manual_cto38 -qc "UPDATE \"Tenant\" SET plan='STARTER' WHERE id=(SELECT \"tenantId\" FROM \"Clinic\" WHERE slug='$SUB')"
ADD=$(req POST /site/domains '{"hostname":"www.example.com"}')
ID=$(echo $ADD | P 'd.data.id')
echo "B-2 added: $(echo $ADD | P "d.data.stage + ' zone=' + d.data.zone + ' provider=' + (d.data.dnsProvider && d.data.dnsProvider.key)")"
echo "B-3 records: $(echo $ADD | P "d.data.records.map(r => r.type + ' ' + r.host + ' -> ' + r.value).join(' | ')")"
echo "B-4 first poll: $(req GET /site/domains/$ID/status | P "d.data.stage + ' / ' + d.data.lastError")"
echo "B-5 per-record: $(req GET /site/domains/$ID/status | P "d.data.checks.map(c => c.type + (c.ok ? ' ok' : ' NO: ' + c.message)).join(' | ')")"
T1=$(req GET /site/domains/$ID/status | P 'd.data.lastCheckedAt'); T2=$(req GET /site/domains/$ID/status | P 'd.data.lastCheckedAt')
echo "B-6 throttled (same check time): $([ "$T1" = "$T2" ] && echo yes || echo no)"
echo "B-7 connect: $(req GET /site/domains/$ID/connect | P "JSON.stringify(d.data)")"
echo "B-8 return with a bad state: $(code POST /site/domains/$ID/connect/return '{"state":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}')"
echo "B-9 primary before verified: $(code POST /site/domains/$ID/primary)"
```

**Expect:**

```
B-1 FREE plan: 402
B-2 added: dns zone=example.com provider=other
B-3 records: CNAME www -> medoflow.pages.dev | TXT _medoflow-verify.www -> medoflow-verify=<32 hex>
B-4 first poll: dns / TXT record _medoflow-verify.www.example.com not found yet (DNS changes can take up to an hour)
B-5 per-record: CNAME NO: www.example.com has an A record (<IP>) instead of a CNAME to medoflow.pages.dev. Delete the A record, then add the CNAME | TXT NO: TXT record … not found yet …
B-6 throttled (same check time): yes
B-7 connect: {"available":false,"reason":"not_configured"}
B-8 return with a bad state: 400
B-9 primary before verified: 409
```

(`www.example.com` may be a CNAME on some days; then B-5 says "points to … expected medoflow.pages.dev". Either way it is the real answer, in plain words.)

### 9.5 Browser checks

Open `http://localhost:3011`, sign in as `owner.<RUN>@example.test` with `MANUAL_PASSWORD`, and go to **Website → Domains**.

| #   | Do                                                                                                         | Expect                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | Look at `www.example.com` under **Your own domain**                                                        | the stepper is on **DNS records**; "Add these records where the DNS for example.com is managed"; Host `www` and `_medoflow-verify.www`, full names in grey under them; copy buttons copy each value        |
| W-2 | Wait about 10 s                                                                                            | the **Check** column shows ✗ with the A-record and TXT messages; no Verify click needed                                                                                                                    |
| W-3 | Enter `example.com` (root) and **Add domain** (first remove `www.example.com`, because STARTER allows one) | the domain is added (the `manual` provider allows roots) with the amber "Root domains … can't use a CNAME" note. Under `pages`, the API refuses it with **Add www.example.com instead** (covered by tests) |
| W-4 | Run D-2, then wait 10 s                                                                                    | the stepper moves to **HTTPS certificate**, pill "Setting up HTTPS", with a red "DNS for … no longer looks right" line (background checks never un-verify)                                                 |
| W-5 | Run D-3, then reload                                                                                       | stepper all green, pill **Live**, **Make primary** shown, forwarding tip under it                                                                                                                          |
| W-6 | Press **Check now**                                                                                        | a real check: the domain goes back to **DNS records** (a person can un-verify)                                                                                                                             |

### 9.6 Database checks

```zsh
# D-1 the new columns
docker exec mf-pg psql -U postgres -d mf_manual_cto38 -c "SELECT hostname, kind, status, stage, \"dnsProvider\", zone, \"lastCheckedAt\" FROM \"SiteDomain\" ORDER BY \"createdAt\""
# D-2 pretend Cloudflare issued the certificate (W-4)
docker exec mf-pg psql -U postgres -d mf_manual_cto38 -c "UPDATE \"SiteDomain\" SET status='VERIFIED', stage='ssl', \"sslStatus\"='active', \"lastError\"=NULL, \"lastCheckedAt\"=NULL WHERE hostname='www.example.com'"
# D-3 pretend the HTTPS probe passed (W-5)
docker exec mf-pg psql -U postgres -d mf_manual_cto38 -c "UPDATE \"SiteDomain\" SET stage='live', \"lastError\"=NULL, \"liveAt\"=now() WHERE hostname='www.example.com'"
# D-4 audit rows: added, check failed (Check now), stage changes, drift
docker exec mf-pg psql -U postgres -d mf_manual_cto38 -c "SELECT action, \"newValue\", \"performedById\" IS NULL AS system FROM \"AuditLog\" WHERE \"entityType\"='SiteDomain' ORDER BY \"createdAt\""
```

**Expect:**

- **D-1:** the subdomain is `live`, and `www.example.com` is `dns` with zone `example.com` and provider `other`.
- **D-4:**
  - `SITE_DOMAIN_ADDED`;
  - `SITE_DOMAIN_DRIFT` once, after D-2;
  - `SITE_DOMAIN_CHECK_FAILED` and `SITE_DOMAIN_STAGE` (`live` → `dns`) after W-6;
  - no row per poll.

### 9.7 Clean up

```zsh
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual_cto38 WITH (FORCE)"
rm -f ~/Work/AdvertOut/MedoFlow/backend/.env.cto38.local
```

### 9.8 Result sheet

| Check                        | Pass? | Notes |
| ---------------------------- | ----- | ----- |
| B-1 to B-9                   |       |       |
| W-1 to W-6                   |       |       |
| D-1 to D-4                   |       |       |
| AC4 real domain (§6, step 3) |       |       |

### 9.9 Troubleshooting

| You see                                             | Why                                                                      | Fix                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| B-2 shows `zone=null provider=null`                 | no internet, or DNS blocked                                              | check the network; the domain is still added, just without detection |
| The stepper never moves                             | the tab is in the background (polling pauses), or 30 minutes have passed | bring the tab forward, or press **Check again**                      |
| `credentials for medoflow_app are not valid`        | the local role password changed                                          | see the note in §9.2                                                 |
| `409 site_domain_not_live` on Make primary (hosted) | HTTPS isn't working yet                                                  | wait for **Live**; check CAA records and that the CNAME is DNS only  |
| `503 site_domain_capacity` (hosted)                 | the Pages project has 100 custom domains                                 | remove unused ones in Cloudflare, or upgrade the Cloudflare plan     |
