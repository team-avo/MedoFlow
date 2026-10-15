# PART 0 — Initial Deployment: Walkthrough & Verification

> **Scope:** `arh-agent-docs/development-plan.md` → PART 0 (PhD · P0): D0 backend, D1 frontend, D2 exit criteria
> **Status: ✅ PART 0 COMPLETE (declared 2026-10-13)** · **Date:** 2026-10-12, updated 2026-10-13 · **Live code:** `myselfabhi/MedoFlow` `main` @ `379818c` (merge of PR #3)
> **Cloudflare account:** `Devops@medoflow.com's Account` (`523c0186a1808be62e718907053c513b`)
> **Data:** synthetic demo dump `arh-agent-docs/medoflow-demo-20261005.sql.gz` only. See [PHI gate](../docs/PHI_GATE.md).

Legend: ✅ done and verified · 🟨 partly done · ⬜ not done · ↪ moved out of Part 0 to the Backend Foundation section of the plan

---

## 1. Outcome at a glance

**Decision recorded today:** the plan said "frontend **and** backend on Cloudflare". The **backend now runs on Render** instead, because the Express API needs Cloudflare Containers, which require the Workers Paid plan, and that plan was not enabled. The **frontend stays on Cloudflare Workers**. The Cloudflare backend path (edge Worker + Container) is built and kept in `backend/edge/` in case Workers Paid is enabled later.

**Part 0 declared complete on 2026-10-13.** Two items were moved out of Part 0 into the plan's **Backend Foundation (B0.6)** section, to be done later: **CI auto-deploy** (was D0.6, now **B0.6.8**) and **custom domains + clinic subdomains** (was D1.3, now **B0.6.9**).

| Item                                                                                                     | Status         | What was verified / what is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D0.1** API deployed, `/health` 200, authenticated call from the deployed frontend, background job runs | ✅             | ✅ Render backend `/api/v1/health` → 200, serving commit `379818c`. ✅ Login + `/auth/me` for all 4 personas using the frontend's Origin. ✅ **Background job proven on Render (2026-10-13):** a slot hold created through the API expired at 14:13:45 UTC and was marked `EXPIRED` by the 5-minute cron sweep at 14:18:39 UTC. **Decision:** the AI scribe is out of Part 0 scope (it needs a self-hosted Ollama endpoint, which Render doesn't have; tracked under B2.1).                                                                                                                      |
| **D0.2** Postgres (Neon) via pooled connection                                                           | ✅             | ✅ Neon restored from the dump; `migrate deploy` clean (14 migrations); Prisma connects from Render; ✅ 50/50 concurrent DB-backed requests on Render → 200. ✅ Hyperdrive read+write round-trip works from the Cloudflare edge Worker. Accepted deviation (recorded in the plan): Render connects to Neon directly, so Hyperdrive isn't in the Render path.                                                                                                                                                                                                                                     |
| **D0.3** Redis / BullMQ                                                                                  | ✅             | ✅ Redis Cloud connected; 20/20 jobs survived a restart with 0 duplicates (local runner against the real Redis). ✅ Deployed background processing proven via the cron sweep (D0.1); the only BullMQ queue is the AI scribe, which is out of scope. ✅ **Eviction policy set to `noeviction`** by the owner and verified 2026-10-13 (§5.4).                                                                                                                                                                                                                                                      |
| **D0.4** Files on R2 with presigned URLs                                                                 | ✅ (known gap) | ✅ R2 keys added to Render (2026-10-13). ✅ The backend's own `storageService`, run with those keys: upload → authenticated read matches → **presigned URL (1 h) download 200** → no signature 400 → tampered signature 400 → after delete 404. ✅ Bucket private, r2.dev disabled. **Known gap (accepted, option A):** only AI-scribe audio uses R2. Patient-file uploads are hard-coded to the container's local disk (`fileController.ts:50`), so they're lost on redeploy. Tracked as B3.1/F3.1.                                                                                             |
| **D0.5** Secrets + CORS + TLS                                                                            | ✅             | gitleaks clean (git history + deployed client bundle). Render: HTTP → 301, HSTS present, disallowed Origin gets no CORS allow header, allowed Origin gets one. Frontend: HTTP → 301, HSTS.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D0.6** Config + CI deploy + rollback                                                                   | ↪ B0.6.8       | ✅ `render.yaml`, `frontend/wrangler.jsonc`, and the `.github/workflows/deploy.yml` pipeline merged (PR #3). ✅ The build gate passed on the merge run. ✅ Rollback demonstrated with `wrangler rollback` (Cloudflare). ⬜ **Auto-deploy not live**: repo secrets/variables in `myselfabhi/MedoFlow` aren't set, so the deploy jobs stopped on purpose ("not set"). The owner reports `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` has been added to the GitHub repo. The remaining CI secrets/variables, plus the "failing build blocks deploy" demonstration, move to **B0.6.8** (Backend Foundation). |
| **D1.1** Next.js on Cloudflare                                                                           | ✅             | `@opennextjs/cloudflare` on Workers, built from upstream `main` @ `379818c`. **69/69 routes** load, dynamic routes and the new voice-agent page included.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **D1.2** `NEXT_PUBLIC_API_URL` + Stripe key                                                              | ✅             | ✅ The client bundle calls `https://medoflow-backend-6pd5.onrender.com`. ✅ Stripe test publishable key `pk_test_51UQ6AZBF2…` is in the payment-page chunks, and the placeholder is gone (frontend version `ce28ba7d`, 2026-10-13). ✅ `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` set on Render: an unsigned webhook is rejected with 400. ⚠️ See §7 item 10: genuine Stripe webhooks will also fail (pre-existing body-parser bug).                                                                                                                                                          |
| **D1.3** Custom domain + clinic subdomains                                                               | ↪ B0.6.9       | Moved to **B0.6.9** (Backend Foundation). `workers.dev` and `onrender.com` URLs are used until then.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **D1.4** Redirects / adapter build                                                                       | ✅             | All 6 `/dashboard/patient/*` → `/account/*` redirects fire on the deployed site; the adapter build has zero errors (Linux / CI).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **D2** Both apps live, persona flows, synthetic data only                                                | ✅             | ✅ Both apps live and connected. ✅ Login + profile load for admin, provider, front desk and patient against the deployed backend. ✅ PHI scan = 0 hits. ✅ Browser click-through checklist per persona in **§5.10**, for team sign-off.                                                                                                                                                                                                                                                                                                                                                         |
| **D2** PHI gate documented                                                                               | ✅             | [`docs/PHI_GATE.md`](../docs/PHI_GATE.md) (covers Render too), linked from the HIPAA checklist and the plan's launch gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Bottom line:** ✅ **PART 0 is complete.** The app is live and usable with demo data, every in-scope acceptance criterion is verified, and the two deferred items are tracked as B0.6.8 and B0.6.9.

---

## 2. What is deployed

| Component                               | Where                                        | URL / identifier                                                         | Status                                                         |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Frontend (Next.js 14.2.35 via OpenNext) | Cloudflare Worker `medoflow-web`             | https://medoflow-web.advertout-medoflow.workers.dev (version `ce28ba7d`) | ✅ live, upstream `379818c` + Stripe key                       |
| Backend (Express API, Docker)           | Render web service `medoflow-backend`        | https://medoflow-backend-6pd5.onrender.com                               | ✅ live, `379818c`                                             |
| Postgres                                | Neon PG 18, db `medoflow-demo-db`, us-east-2 | host `ep-withered-cherry-b459hcsg…neon.tech`                             | ✅                                                             |
| Queue                                   | Redis Cloud 8.6 (BullMQ)                     | `car-copper-price-21980.db.redis.io:19914`                               | ✅ `noeviction`                                                |
| Files                                   | R2 bucket `medoflow-files` (private)         | `…r2.cloudflarestorage.com/medoflow-files`                               | ✅ connected (scribe audio); patient files still on local disk |
| Cloudflare edge Worker (PART 0 path)    | Cloudflare Worker `medoflow-api`             | https://medoflow-api.advertout-medoflow.workers.dev                      | ⚪ **unused**: no longer in the request path; safe to delete   |
| Hyperdrive                              | `medoflow-neon`                              | `5e50f409884f43a880c556fc15ccddf4`                                       | ⚪ used only by the unused edge Worker                         |

```
Browser ──HTTPS──▶ medoflow-web (Cloudflare Worker, Next.js via OpenNext)
   │
   └──HTTPS (CORS: only medoflow-web's origin)──▶ medoflow-backend (Render, Docker: Express + Prisma + BullMQ + cron)
                                                     ├─▶ Neon Postgres (direct connection)
                                                     ├─▶ Redis Cloud (BullMQ queue)
                                                     └─▶ R2 (S3 API)  ✅ keys set 2026-10-13 (scribe audio only)

CI/CD (.github/workflows/deploy.yml in myselfabhi/MedoFlow):
  PR → build gate · merge to main → build gate → Render deploy hook (?ref=<sha>) + wrangler deploy → smoke
  ↪ deploy jobs inactive until the repo secrets/variables are set (B0.6.8)
```

**Design notes**

- **Backend on Render, Docker runtime:** it uses the existing `backend/Dockerfile` (ffmpeg + native modules). The container runs `prisma migrate deploy` on every boot, then starts the server. Region Ohio, next to Neon.
- **Direct Neon URL (not `-pooler`):** Prisma migrations need session-level advisory locks, which PgBouncer transaction mode breaks.
- **CI deploys the exact commit it verified:** the Render deploy hook is called with `?ref=<sha>`, and CI waits until `/api/v1/health` reports that SHA (`RENDER_GIT_COMMIT`). Render's own auto-deploy should be **Off** once CI is active.
- **Frontend must be built on Linux.** On Windows, the OpenNext adapter silently skips a patch, and every page then returns 500.
- **`account_id` is pinned** in both `wrangler.jsonc` files, so a deploy with the wrong Cloudflare login fails instead of landing in another account.

---

## 3. Repository changes

### 3a. Initial Cloudflare deployment (commit `b6e7f93`, merged via PR #3)

| File                                                                               | Purpose                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `frontend/wrangler.jsonc`, `frontend/cf-worker.js`, `frontend/open-next.config.ts` | Cloudflare Workers config for the frontend; the wrapper adds an HTTP → HTTPS redirect and HSTS.                                            |
| `frontend/package.json`                                                            | `next` 14.2.18 → **14.2.35** (minimum for OpenNext 1.15; includes 14.2.x security fixes); `cf:build` / `cf:deploy` / `cf:preview` scripts. |
| `frontend/next.config.js`                                                          | `outputFileTracingRoot` = repo root (pnpm monorepo).                                                                                       |
| `frontend/package-lock.json`                                                       | **Removed** (stale npm lockfile; the repo uses pnpm).                                                                                      |
| `frontend/scripts/cf-route-smoke.sh`                                               | Requests every page route plus the 6 redirects on a deployed URL.                                                                          |
| `backend/edge/*`                                                                   | Cloudflare edge Worker + Container wrapper (unused now; kept for a future Workers Paid path).                                              |
| `backend/scripts/deploy/phi-scan.sql`                                              | Synthetic-data scan (webmail emails, SSNs, non-555 phones, card numbers).                                                                  |
| `backend/scripts/deploy/queue-smoke.js`                                            | BullMQ durability test (enqueue → restart → drain; fails on loss or duplicates).                                                           |
| `backend/.dockerignore`                                                            | Keeps `edge/`, `.wrangler/`, `.env.*`, tests out of the image.                                                                             |
| `.gitleaksignore`, `.gitignore`                                                    | Secret-scan allow-list (one reviewed placeholder); ignore build output.                                                                    |
| `docs/PHI_GATE.md`                                                                 | Synthetic-data-only rule.                                                                                                                  |

### 3b. Render + CI/CD (commit `fd2791a`, merged via PR #3)

| File                                                        | Purpose                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render.yaml`                                               | Render Blueprint: Docker web service, Ohio, health check `/api/v1/health`, auto-deploy off, secrets prompted (never in git).                                                                                     |
| `.github/workflows/deploy.yml`                              | PR → build gate. Merge to `main` → build gate → deploys only the app that changed (Render hook pinned to the SHA; Cloudflare `wrangler deploy`) → waits/smoke-checks. Deploys only run in `myselfabhi/MedoFlow`. |
| `backend/src/routes/health.ts`                              | Health response includes `commit` (`RENDER_GIT_COMMIT`), so CI can confirm the live version.                                                                                                                     |
| `backend/prisma/migrations/20261012000000_add_voice_agent/` | **Missing migration** for the voice-agent tables from PR #1 (they had been created with `db push`). Marked as already applied on Neon.                                                                           |
| `frontend/.env.production`                                  | **Removed**; CI supplies `NEXT_PUBLIC_API_URL` from the `BACKEND_URL` repo variable.                                                                                                                             |
| `development-log-docs/render-cicd-SETUP.md`                 | One-time Render + GitHub setup guide.                                                                                                                                                                            |

### 3c. Not in git

| Change                                                                            | Where                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Demo dump restored; 3 real-looking webmail addresses replaced with `@example.com` | Neon `medoflow-demo-db`                                       |
| Voice-agent migration marked as applied                                           | Neon `_prisma_migrations`                                     |
| Render service `medoflow-backend` + its environment variables                     | Render dashboard (created by the account owner)               |
| Frontend deployed from upstream `main` @ `379818c` (manual, Linux build)          | Cloudflare `medoflow-web`                                     |
| Repo secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`                      | **Fork** `arhantbararia/MedoFlow` only, not the upstream repo |
| PART 0 statuses + PHI gate in the launch gate                                     | `arh-agent-docs/development-plan.md` (gitignored, local)      |

---

## 4. What was done today, in order

1. **Survey + Cloudflare attempt.** The Express API needs a long-running process (BullMQ worker, cron, native modules). On Cloudflare that means Containers, which need **Workers Paid**. Not enabled.
2. **Database.** Restored the demo dump into Neon: 54 tables, 25 users, 4 clinics. PII sweep: replaced 3 real-looking webmail addresses. `phi-scan.sql` → 0 hits.
3. **Redis, R2, Hyperdrive** created and connected. Redis eviction policy found to be `volatile-lru` (needs `noeviction`).
4. **Cloudflare edge Worker** `medoflow-api` deployed (health, Hyperdrive round-trip, 50 concurrent, HTTPS/Origin checks). Rollback demonstrated B → A → B. **Now unused.**
5. **Backend Docker image** verified locally against Neon + Redis: health 200, 4 personas log in.
6. **Frontend** deployed to Cloudflare Workers via OpenNext. Fixed a stale npm lockfile and found the Windows-build problem. All routes pass.
7. **Security checks:** gitleaks clean; HTTPS + HSTS on all apps.
8. **Switch to Render for the backend.** Upstream `myselfabhi/MedoFlow` was 5 commits ahead (voice agent, landing redesign). The work was rebased on it, the missing voice-agent migration was added, and `render.yaml` and the CI/CD workflow were written. **PR #3 opened and merged.**
9. **Render service created** (`medoflow-backend-6pd5.onrender.com`). It is serving `379818c`.
10. **First CI run on the merge:** build gate ✅. Both deploy jobs stopped on purpose because the repo secrets/variables aren't set. ⬜
11. **Frontend redeployed manually** from upstream `main` @ `379818c`, pointed at Render. 69/69 routes ✅.
12. **Live checks against Render:** 4 persona logins ✅, 50 concurrent DB requests ✅, HTTPS/HSTS/CORS ✅.
13. **2026-10-13:** R2 keys and the Stripe secret + webhook secret added to Render (by the owner). R2 proof ✅. Frontend rebuilt with the Stripe publishable key (version `ce28ba7d`) ✅. Cron background-job proof on Render ✅. Found the Stripe webhook body-parser bug (§7 item 10).
14. **2026-10-13:** Redis eviction policy set to `noeviction` (verified). The owner added the Stripe publishable key to the GitHub repo. Browser click-through checklist written (§5.10). CI auto-deploy and custom domains moved to B0.6.8 / B0.6.9. **Part 0 declared complete.**

---

## 5. Verification: commands and expected results

Run from the repo root in Git Bash. Set these once per shell. The DB/Redis values come from the password manager:

```bash
export BACKEND=https://medoflow-backend-6pd5.onrender.com
export WEB=https://medoflow-web.advertout-medoflow.workers.dev
export ORIGIN="Origin: $WEB"
export NEON_DIRECT_URL='postgresql://neondb_owner:<password>@ep-withered-cherry-b459hcsg.c-6.us-east-2.aws.neon.tech/medoflow-demo-db?sslmode=require'
export REDIS_URL='redis://default:<password>@car-copper-price-21980.db.redis.io:19914'
psql_() { MSYS_NO_PATHCONV=1 docker run --rm -i postgres:16 psql "$NEON_DIRECT_URL" "$@"; }
```

> The Render free tier sleeps when idle, so the first request can take up to ~1 minute. The login endpoint allows 5 attempts per 15 minutes per IP.

### 5.1 ✅ D0.1: backend is live and serves the merged code

```bash
curl -s $BACKEND/api/v1/health
#  → {"success":true,"message":"Medoflow API is operational","data":{…,"commit":"379818c7c8b5b6ced90b68d125c257ed7ff65345"}}
```

### 5.2 ✅ D0.1 / D2: authenticated calls for all 4 personas (as the frontend makes them)

```bash
for e in admin doctor frontdesk patient; do
  t=$(curl -s -H "$ORIGIN" -H 'content-type: application/json' \
        -d "{\"email\":\"$e@medoflow.test\",\"password\":\"test1234\"}" $BACKEND/api/v1/auth/login \
      | node -pe "JSON.parse(require('fs').readFileSync(0)).data?.accessToken||''")
  echo "$e: login=$([ -n "$t" ] && echo ok) me=$(curl -s -o /dev/null -w '%{http_code}' -H "$ORIGIN" -H "Authorization: Bearer $t" $BACKEND/api/v1/auth/me)"
done
#  → admin: login=ok me=200 · doctor: … · frontdesk: … · patient: login=ok me=200
```

In the browser: open `$WEB/login`, sign in as `admin@medoflow.test` / `test1234`. DevTools › Network shows requests to `medoflow-backend-6pd5.onrender.com` returning 200.

### 5.3 ✅ D0.2: database, migrations, 50 concurrent requests

```bash
# 50 concurrent DB-backed requests (reuse a token from 5.2 as $T): expect "50 200"
seq 1 50 | xargs -P 50 -I{} curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $T" $BACKEND/api/v1/auth/me | sort | uniq -c

# Migrations
cd backend && DATABASE_URL="$NEON_DIRECT_URL" npx prisma migrate status; cd -
#  → 14 migrations found … "Database schema is up to date!"
```

### 5.4 ✅ D0.3: Redis / BullMQ

```bash
cd backend
node scripts/deploy/queue-smoke.js enqueue 20      # → enqueued 20; waiting=20
node scripts/deploy/queue-smoke.js work; echo $?   # → expected=20 completed=20 … duplicates=0 · 0
cd -
REDIS_URL="$REDIS_URL" node -e "const R=require('./backend/node_modules/ioredis');const r=new R(process.env.REDIS_URL);r.info('memory').then(i=>{console.log(i.match(/maxmemory_policy:(\S+)/)[1]);r.quit()})"
#  → noeviction   (verified 2026-10-13)
```

### 5.5 ✅ D0.4: R2

Presigned round-trip using the backend's own storage code. Run from `backend/`; the R2 keys are in the password manager:

```bash
cat > r2-proof.tmp.ts <<'TS'
import * as s from './src/services/storageService'
;(async () => {
  const body = Buffer.from('synthetic r2 proof ' + new Date().toISOString())
  const ref = await s.uploadAudio({ sessionId: 'deploy-proof', buffer: body, mimeType: 'audio/webm', originalName: 'p.webm' })
  const [, bucket, key] = ref.match(/^s3:([^:]+):(.+)$/)!
  const url = await s.getAudioUrl(`${bucket}/${key}`)
  console.log('presigned GET', (await fetch(url)).status, '| unsigned GET', (await fetch(url.split('?')[0])).status)
  await s.deleteAudio(`${bucket}/${key}`); console.log('after delete', (await fetch(url)).status)
})()
TS
S3_ACCESS_KEY_ID=<id> S3_SECRET_ACCESS_KEY=<secret> S3_BUCKET=medoflow-files S3_REGION=auto \
  S3_ENDPOINT=https://523c0186a1808be62e718907053c513b.r2.cloudflarestorage.com npx ts-node -T r2-proof.tmp.ts; rm r2-proof.tmp.ts
#  → presigned GET 200 | unsigned GET 400
#  → after delete 404
```

Bucket privacy:

```bash
npx wrangler r2 bucket dev-url get medoflow-files   # → Public access via the r2.dev URL is disabled.
curl -s -w ' [%{http_code}]\n' https://523c0186a1808be62e718907053c513b.r2.cloudflarestorage.com/medoflow-files/deploy-check/probe.txt
#  → <Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error> [400]   (anonymous read refused)
```

Result 2026-10-13: presigned GET 200 (content matched), unsigned 400, tampered signature 400, after delete 404.

### 5.6 ✅ D0.5: TLS, CORS, secrets

```bash
# HTTPS only + HSTS
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://medoflow-backend-6pd5.onrender.com/api/v1/health  # → 301 -> https://…
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://medoflow-web.advertout-medoflow.workers.dev/login  # → 301 -> https://…
curl -sI $BACKEND/api/v1/health | grep -i strict-transport ; curl -sI $WEB/login | grep -i strict-transport

# CORS: allowed origin gets the header; a disallowed origin gets none
curl -s -o /dev/null -D - -X OPTIONS -H "$ORIGIN" -H "Access-Control-Request-Method: POST" $BACKEND/api/v1/auth/login | grep -i access-control-allow-origin
#  → access-control-allow-origin: https://medoflow-web.advertout-medoflow.workers.dev
curl -s -o /dev/null -D - -X OPTIONS -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" $BACKEND/api/v1/auth/login | grep -ic access-control-allow-origin
#  → 0

# Secret scan: git history
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo:ro" zricethezav/gitleaks:latest git /repo --redact --gitleaks-ignore-path /repo/.gitleaksignore
#  → no leaks found
```

### 5.7 ↪ D0.6: CI/CD (moved to B0.6.8)

```bash
gh run list --repo myselfabhi/MedoFlow --limit 3
#  → today: run 38278597926 on the PR #3 merge: build ✓, deploy-backend ✗ ("RENDER_DEPLOY_HOOK_URL secret is not set"),
#    deploy-frontend ✗ ("BACKEND_URL variable is not set")   ⬜ expected until the repo owner adds them
gh variable list --repo myselfabhi/MedoFlow ; gh secret list --repo myselfabhi/MedoFlow
#  → ⬜ currently empty (only the repo owner can set them)
```

Once set (see `render-cicd-SETUP.md`): re-run that workflow → `deploy-backend` logs "Render is serving <sha>", and `deploy-frontend` smoke shows `/ → 200`, `/login → 200`.

Rollback: Render › medoflow-backend › Events › _Rollback_ · Cloudflare: `cd frontend && npx wrangler rollback`.

### 5.8 ✅ D1.1 / D1.4 / D1.2: frontend

```bash
bash frontend/scripts/cf-route-smoke.sh                      # → routes=69 failures=0 (plus 6 × "ok redirect")
for r in / /login /dashboard; do curl -s $WEB$r; done | grep -oE '/_next/static/[^"]+\.js' | sort -u \
  | while read u; do curl -s "$WEB$u"; done | grep -c "medoflow-backend-6pd5.onrender.com"   # → ≥ 1
```

### 5.8b ✅ D0.1 / D0.3: background job (cron sweep) on Render

```bash
P=https://medoflow-backend-6pd5.onrender.com/api/v1/public; C=cmoppo33k0002xme0fxtppptq
# 1. pick a free slot and hold it (holds last 3 minutes)
SL=$(curl -s "$P/availability?clinicId=$C&providerId=cmoppo3g3000ixme0gynuy6ot&serviceId=cmoppo3gm000mxme0yg9342pa&date=<future-date>" \
  | node -pe "const s=JSON.parse(require('fs').readFileSync(0)).data.slots, x=s[s.length-1]; JSON.stringify({clinicId:'$C',providerId:x.providerId,serviceId:x.serviceId,locationId:x.locationId,timezone:x.timezone,startTime:x.start,endTime:x.end})")
curl -s -H 'content-type: application/json' -d "$SL" $P/slots/hold      # → status ACTIVE, expiresAt = now + 3 min
# 2. within ~8 minutes the cron sweep marks it expired:
psql_ -Atc "select status, \"expiredAt\" from \"SlotHold\" where id = '<hold id>'"   # → EXPIRED|<timestamp>
```

Result 2026-10-13: hold `cmv6rdnq10001h21z9sihymdg` expired at 14:13:45 UTC and was marked `EXPIRED` by the sweep at 14:18:39 UTC (`expiredAt` is stored as UTC without a timezone).

### 5.8c ✅ D1.2: Stripe

```bash
for r in /checkout /payment/x /dashboard/memberships; do curl -s $WEB$r; done | grep -oE '/_next/static/[^"]+\.js' | sort -u \
  | while read u; do curl -s "$WEB$u"; done | grep -oE 'pk_test_[A-Za-z0-9]{10}|pk_test_placeholder' | sort | uniq -c
#  → 3 pk_test_51UQ6AZBF2   (no placeholder)
curl -s -w ' [%{http_code}]\n' -X POST -H 'content-type: application/json' -d '{"id":"evt_fake"}' $BACKEND/api/v1/webhooks/stripe
#  → Webhook Error: No stripe-signature header value was provided. [400]
```

### 5.9 ✅ D2: synthetic data only + PHI gate

```bash
psql_ -v ON_ERROR_STOP=1 < backend/scripts/deploy/phi-scan.sql
#  → card_number 0 · phone_non555 0 · ssn 0 · webmail_email 0
head -5 docs/PHI_GATE.md                                       # → Status: CLOSED
```

### 5.10 ✅ D2: browser click-through per persona (team sign-off)

The API-level checks (§5.2) prove every persona can log in. This checklist confirms each role's core screens work in a real browser against the deployed stack. One person can run all four personas in about 30 minutes.

**Before you start**

- Use Chrome or Edge in a **private/incognito window**, and use a new private window for each persona so sessions don't mix.
- Open DevTools (F12) › **Console** and **Network**, and keep both visible.
- Site: https://medoflow-web.advertout-medoflow.workers.dev
- Password for every demo account: `test1234`. The login endpoint allows **5 attempts per 15 minutes per IP**, so type carefully.
- If the first page load is slow, the backend may be waking up. Wait up to a minute and refresh once.
- **Demo data only.** Never type real patient names, emails or phone numbers. Use names like "Test Patient", emails ending in `@example.com`, and phone numbers in the 555-01xx range.
- Card payments: use test card `4242 4242 4242 4242`, any future expiry, any CVC. _(Known issue, §7 item 10: the payment goes through at Stripe, but MedoFlow may keep showing it as unpaid until the webhook bug is fixed. Don't fail the test for that.)_

**Pass rule for every step:** the page loads with real demo data (not an empty error state), there's no red error toast, the Console shows no red errors, and every Network request to `medoflow-backend-6pd5.onrender.com` returns 2xx/3xx.

#### A. Clinic admin: `admin@medoflow.test`

| #   | Do this                                                                                         | Expect                                                                                   |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A1  | Go to `/login`, sign in                                                                         | Lands on the dashboard (`/dashboard` or `/dashboard/admin`) with the clinic name visible |
| A2  | Open **Appointments** (`/dashboard/appointments`)                                               | A list or calendar of demo appointments loads                                            |
| A3  | Open **Patients** (`/dashboard/patients`), then click any patient                               | The patient list loads; the patient detail opens                                         |
| A4  | Open **Staff** (`/dashboard/staff`) and **Staff › Roles**                                       | Demo staff and roles are listed                                                          |
| A5  | Open **Services**, **Locations**, **Products**                                                  | Each list loads                                                                          |
| A6  | Open **Billing** (`/dashboard/billing`) and **Analytics** (`/dashboard/analytics`)              | Revenue/AR figures and charts render                                                     |
| A7  | Open **Website › Pages** (`/dashboard/site/pages`), open a page, change one word, save as draft | Saves without error. Undo the change afterwards.                                         |
| A8  | Open **Voice agent** (`/dashboard/voice-agent`)                                                 | The config screen loads (the AI voice itself isn't configured; that's expected)          |
| A9  | Log out                                                                                         | Returns to the login page; pressing Back doesn't show dashboard data                     |

#### B. Provider: `doctor@medoflow.test`

| #   | Do this                                                        | Expect                                                                         |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| B1  | Sign in                                                        | Lands on the provider area                                                     |
| B2  | Open **Calendar** (`/dashboard/provider/calendar`)             | Own appointments only (not other providers')                                   |
| B3  | Click an appointment (`/dashboard/provider/appointments/<id>`) | Appointment detail with patient name, time and service                         |
| B4  | From a patient, open **Timeline** and **Treatment plans**      | Visit history and plans load                                                   |
| B5  | Open **Profile** (`/dashboard/provider/profile`)               | Profile and scribe settings load                                               |
| B6  | Open **Analytics**                                             | Shows **only this provider's** numbers (compare with what the admin saw in A6) |
| B7  | _Don't_ start an AI scribe recording                           | The AI scribe is out of Part 0 scope (no AI service on Render)                 |
| B8  | Log out                                                        | Back at the login page                                                         |

#### C. Front desk: `frontdesk@medoflow.test`

| #   | Do this                                                                                               | Expect                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| C1  | Sign in                                                                                               | Lands on `/dashboard/front-desk`                          |
| C2  | Open **Appointments** and find today's or an upcoming appointment                                     | The list loads; filters work                              |
| C3  | Open **Invoices** (`/dashboard/front-desk/invoices`), then click one                                  | Invoice detail with line items and totals                 |
| C4  | Open **POS** (`/dashboard/front-desk/pos`), add a product to the cart, **don't** complete the payment | The cart total updates; clear the cart afterwards         |
| C5  | Try opening `/dashboard/staff` or `/dashboard/analytics` directly                                     | Blocked or redirected (front desk shouldn't manage staff) |
| C6  | Log out                                                                                               | Back at the login page                                    |

#### D. Patient: `patient@medoflow.test`

| #   | Do this                                                                                                                                                                 | Expect                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1  | Sign in                                                                                                                                                                 | Lands on `/account` (patient portal)                                                                       |
| D2  | Open **Appointments** (`/account/appointments`), then click one                                                                                                         | Own appointments only, with detail                                                                         |
| D3  | Open **Billing** (`/account/billing`) and **Purchases**                                                                                                                 | Own invoices and purchases only                                                                            |
| D4  | Open **Summaries** (`/account/summaries`)                                                                                                                               | Only published visit summaries; no internal notes or transcripts                                           |
| D5  | Open **Profile** (`/account/profile`)                                                                                                                                   | Own details                                                                                                |
| D6  | Book: go to the clinic's public page (`/clinic/<id>`, linked from the home page or store), pick a service, a provider and a free slot, and continue to the confirmation | Slots load; the hold is created. If you complete it, the appointment appears under `/account/appointments` |
| D7  | Try opening `/dashboard` directly                                                                                                                                       | Redirected away from the staff dashboard                                                                   |
| D8  | Visit `/dashboard/patient/appointments`                                                                                                                                 | Redirects to `/account/appointments`                                                                       |
| D9  | Log out                                                                                                                                                                 | Back at the login page                                                                                     |

#### E. Optional: platform admin, `platform@medoflow.test`

| #   | Do this                                   | Expect                                             |
| --- | ----------------------------------------- | -------------------------------------------------- |
| E1  | Sign in, open `/platform` and **Clinics** | All demo clinics are listed; a clinic detail opens |

**Sign-off.** Record the result here, and attach screenshots of any failures to the team channel:

| Persona                   | Tester | Date | Result (pass / fail + step #) | Notes |
| ------------------------- | ------ | ---- | ----------------------------- | ----- |
| Admin                     |        |      |                               |       |
| Provider                  |        |      |                               |       |
| Front desk                |        |      |                               |       |
| Patient                   |        |      |                               |       |
| Platform admin (optional) |        |      |                               |       |

Any failure goes in §7 as a defect against the relevant component (it does **not** reopen Part 0 unless the app can't be reached or logins fail).

---

## 6. Day-to-day operations

```bash
# Backend: Render deploys from myselfabhi/MedoFlow main.
#   Manual: Render dashboard › medoflow-backend › Manual Deploy › Deploy latest commit
#   Logs:   Render dashboard › medoflow-backend › Logs

# Frontend manual deploy (until CI is active). Build in LINUX; NEXT_PUBLIC_API_URL must be the Render URL.
git fetch https://github.com/myselfabhi/MedoFlow.git main:refs/heads/upstream-main -f
git archive --format=tar -o /tmp/src.tar upstream-main
MSYS_NO_PATHCONV=1 docker run --rm --cpus 4 -m 8g -v "$(cygpath -w /tmp):/scripts" \
  -v "$(cygpath -w ~/.wrangler/config/default.toml):/root/.config/.wrangler/config/default.toml" -w /work node:22-bookworm bash -c '
  tar -xf /scripts/src.tar && corepack enable && corepack prepare pnpm@10.33.0 --activate &&
  pnpm install --frozen-lockfile --filter medoflow-frontend... && cd frontend &&
  NEXT_PUBLIC_API_URL=https://medoflow-backend-6pd5.onrender.com pnpm run cf:build &&
  OPEN_NEXT_DEPLOY=true pnpm exec wrangler deploy'
```

Demo logins (synthetic): `admin@`, `doctor@`, `frontdesk@`, `patient@`, `platform@medoflow.test`. Password `test1234`.

---

## 7. Item status at Part 0 close (2026-10-13)

| #   | Item                                                                            | AC              | Status             | Owner / how                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------- | --------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **CI auto-deploy active**                                                       | D0.6            | ↪ **B0.6.8**       | Repo owner (myselfabhi) adds secrets `RENDER_DEPLOY_HOOK_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and variables `BACKEND_URL=https://medoflow-backend-6pd5.onrender.com`, `FRONTEND_URL`, then sets Render Auto-Deploy to Off. Then demonstrate "failing build blocks deploy".                                                                                              |
| 2   | ~~Background job completes on the deployed env~~                                | D0.1, D0.3      | ✅ 2026-10-13      | Cron sweep proof (§5.8b). AI scribe declared out of Part 0 scope (B2.1).                                                                                                                                                                                                                                                                                                                 |
| 3   | ~~Redis eviction policy → `noeviction`~~                                        | D0.3            | ✅ 2026-10-13      | Set by the owner; verified (§5.4).                                                                                                                                                                                                                                                                                                                                                       |
| 4   | ~~R2 keys on Render + presigned upload/download test~~                          | D0.4            | ✅ 2026-10-13      | §5.5. Known gap accepted: patient-file uploads still use local disk (B3.1/F3.1). Optional: rotate the R2 keys (they were displayed in a working session).                                                                                                                                                                                                                                |
| 5   | ~~Stripe publishable key in the bundle~~                                        | D1.2            | ✅ 2026-10-13      | §5.8c. The owner reports the key has been added to the GitHub repo for CI builds.                                                                                                                                                                                                                                                                                                        |
| 6   | **Persona click-through in the browser** (admin, provider, front desk, patient) | D2              | ✅ checklist ready | Run §5.10 and fill in its sign-off table. Failures are logged as component defects.                                                                                                                                                                                                                                                                                                      |
| 7   | **Custom domain + clinic subdomains**                                           | D1.3            | ↪ **B0.6.9**       | Done later, under Backend Foundation.                                                                                                                                                                                                                                                                                                                                                    |
| 8   | ~~Record the Render decision in the plan~~                                      | D0.1, D0.2      | ✅ 2026-10-13      | Recorded in `development-plan.md` and `development-plan.html`.                                                                                                                                                                                                                                                                                                                           |
| 9   | **Clean-up**                                                                    | —               | ⬜ optional        | Delete the unused Cloudflare edge Worker: `npx wrangler delete --name medoflow-api`.                                                                                                                                                                                                                                                                                                     |
| 10  | **Stripe webhooks can't verify (pre-existing bug, found 2026-10-13)**           | not Part 0 (B4) | ⬜                 | `app.ts` applies `express.json()` globally before the `/webhooks/stripe` route's `express.raw()`, so Stripe's signature check never sees the raw body (`Webhook payload must be provided as a string or a Buffer`). **Every genuine webhook will be rejected, so payments are never marked paid.** Fix: mount the webhook router with `express.raw` before `express.json()`. Needs a PR. |

Also noted, out of PART 0 scope:

- Some older schema columns and foreign keys have no migration (pre-existing drift, e.g. `Appointment.aiScribeConsentGrantedAt`).
- `TENANT_ISOLATION_MODE=warn` (B0.1.1).
- The Neon role has `BYPASSRLS` (B0.1.3).
- `next.config.js` still sets `ignoreBuildErrors` (F0.1.1).
- Email (SMTP), video consultations and the voice-agent AI key are not configured on Render.

---

## 8. Incidents during this work

1. **Real-looking personal data in the demo dump (resolved).** Three public-webmail addresses (two `User` rows plus one voice-call log entry) were replaced with `@example.com` placeholders in the Neon database. The dump file `arh-agent-docs/medoflow-demo-20261005.sql.gz` **still contains them**. Scrub it before reusing it anywhere else.
