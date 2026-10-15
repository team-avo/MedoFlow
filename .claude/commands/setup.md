---
description: Clone, configure, and run MedoFlow end-to-end on a fresh machine (first-time dev setup)
---

# Set up MedoFlow locally

You are setting up the MedoFlow monorepo on this machine from scratch and leaving it **running and verified**. Work through the phases below in order. Explain each step briefly as you go, and stop and ask if something is ambiguous rather than guessing.

## Security rules — non-negotiable

- **Never print, echo, log, or write the user's GitHub PAT anywhere.** Not in a file, not in a command you show, not in `.git/config`.
- After cloning, **strip the token from the git remote** (see Phase 2).
- **Never commit `.env` / `.env.local`.** They are gitignored — keep it that way.
- If the user pastes a secret in chat, do not repeat it back.

---

## Phase 0 — Prerequisites

Check what's installed and report a table of ✅/❌. Do **not** auto-install anything without asking.

| Requirement           | Check           | Notes                                                                      |
| --------------------- | --------------- | -------------------------------------------------------------------------- |
| Node ≥ 20             | `node -v`       | Required                                                                   |
| pnpm ≥ 10             | `pnpm -v`       | Install: `npm install -g pnpm`                                             |
| Git                   | `git --version` | Required                                                                   |
| Docker Desktop        | `docker info`   | Required (runs Postgres + Redis) — must be **running**, not just installed |
| GitHub CLI (optional) | `gh --version`  | Nicest way to auth                                                         |

If anything's missing, tell the user exactly what to install, then stop and wait.

**macOS Docker note:** if `docker info` fails but Docker Desktop is open, the socket path may need setting. Try prefixing docker commands with:
`DOCKER_HOST=unix://$HOME/.docker/run/docker.sock`

---

## Phase 1 — Choose a location

Ask the user where to put the project (suggest `~/Development/MedoFlow`). If the repo already exists there, **skip the clone** and just `git pull` instead.

---

## Phase 2 — Clone (PAT handling)

Repo: `https://github.com/team-avo/MedoFlow.git`. The working branch is `development`, which is also the default branch and the one that deploys. Open PRs into `development`.

**Preferred — GitHub CLI:**

```
gh auth login
gh repo clone team-avo/MedoFlow
```

This stores credentials safely in the system keychain. Use this if `gh` is available.

**Fallback — PAT:**
Ask the user to paste a Personal Access Token with write access to team-avo/MedoFlow (needed to push). Then clone using it **without echoing it**, and immediately scrub it:

```
git clone https://<TOKEN>@github.com/team-avo/MedoFlow.git
cd MedoFlow
git remote set-url origin https://github.com/team-avo/MedoFlow.git
```

> The `set-url` step is important — cloning with a token embeds it in plaintext in `.git/config`. Always strip it.

Then suggest caching credentials properly so future pulls work:

- macOS: `git config --global credential.helper osxkeychain`
- Windows: `git config --global credential.helper manager`

Confirm the clone worked and is on `development` (`git branch --show-current`, `git log --oneline -3`).

---

## Phase 3 — Install dependencies

From the repo root:

```
pnpm install
```

This is a pnpm workspace — it installs both `frontend/` and `backend/`. Expect a few deprecation warnings; they're fine.

---

## Phase 4 — Start the databases

**Postgres** (runs on **port 5433**, deliberately — avoids clashing with any system Postgres on 5432):

```
docker compose -f docker-compose.dev.yml up -d
```

**Redis** (needed for the AI Scribe background queue — not in the compose file):

```
docker run -d --name medoflow-redis -p 6379:6379 redis:7-alpine
```

If the container already exists: `docker start medoflow-redis`.

Verify both are reachable before continuing:

```
nc -z localhost 5433 && echo "postgres UP"
nc -z localhost 6379 && echo "redis UP"
```

---

## Phase 5 — Environment files

### Backend — `backend/.env`

Copy the template: `cp backend/.env.example backend/.env`, then set these.

**Required to boot:**

```
PORT=3001
NODE_ENV=development
DATABASE_URL="postgresql://medoflow:medoflow@localhost:5433/medoflow?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET=<any random string, min 32 chars — generate one locally>
CORS_ORIGIN=http://localhost:3000
```

Generate the JWT secret locally rather than inventing one:
`openssl rand -hex 32`

**Required for the AI Front Desk / voice agent — one key only:**

```
GROQ_API_KEY=<generate your own — free, no credit card>
```

Tell the user to generate their **own** free key at **https://console.groq.com/keys**. Groq powers the entire voice agent (speech-to-text, reasoning, and the voice). Their own key is better than sharing one — the free tier has a daily quota, and two developers on one key will exhaust it and get 502s.

**Optional — features degrade gracefully if absent:**
`STRIPE_SECRET_KEY` (payments), `JAAS_APP_ID` / `JAAS_KID` / `JAAS_PRIVATE_KEY_PATH` (video consultations), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (calendar sync), `SMTP_*` (email), `S3_*` (file uploads). Ask Abhinav for these only if you need to work on those specific features.

> **Never invent API keys, and never commit `.env`.**

### Frontend — `frontend/.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Phase 6 — Database schema + demo data

⚠️ **Use `db push`, not `migrate deploy`.** The voice-agent tables (`VoiceAgentConfig`, `VoiceCall`, `VoiceCallEvent`) were added to `schema.prisma` without a migration file, so `migrate deploy` would produce a database missing them. `db push` syncs the full current schema.

```
cd backend
npx prisma db push
npx prisma generate
```

Then seed the demo clinic (idempotent — safe to re-run):

```
npm run seed:demo
```

This creates **Everwell Longevity Clinic** with 4 providers, 15 patients, ~61 appointments, invoices, packages, memberships, AI scribe sessions, and the **AI Front Desk** (voice-agent config + a sample call log covering every outcome). No DB dump needed — the seed is the source of truth.

---

## Phase 7 — Run it

Start both servers. Use **two background processes** (never block the session):

```
# Backend  → http://localhost:3001
cd backend && pnpm dev

# Frontend → http://localhost:3000
cd frontend && pnpm dev
```

If a port is already occupied, free it first:
`kill $(lsof -ti:3000)` / `kill $(lsof -ti:3001)`

---

## Phase 8 — Verify (do not skip)

Confirm all of these actually pass before declaring success:

```
curl -s -o /dev/null -w "backend  %{http_code}\n" http://localhost:3001/api/v1/health
curl -s -o /dev/null -w "frontend %{http_code}\n" http://localhost:3000/
```

Both must return **200**. The backend health endpoint should return
`{"success":true,"message":"Medoflow API is operational",...}`.

Then open **http://localhost:3000** and confirm the landing page renders.

---

## Phase 9 — Report back

Give the user a short summary:

| Service  | URL                                 | Status |
| -------- | ----------------------------------- | ------ |
| Frontend | http://localhost:3000               |        |
| Backend  | http://localhost:3001/api/v1/health |        |
| Postgres | localhost:5433                      |        |
| Redis    | localhost:6379                      |        |

**Demo logins (from `seed:demo`) — password `Demo1234!` for all, one per role:**

| Role                                    | Email                    | Name           |
| --------------------------------------- | ------------------------ | -------------- |
| PLATFORM_ADMIN (cross-tenant)           | `platform@medoflow.demo` | Pat Okafor     |
| SUPER_ADMIN (clinic owner)              | `alex@everwell.demo`     | Alex Thornton  |
| FRONT_DESK                              | `jordan@everwell.demo`   | Jordan Walsh   |
| ACCOUNTING                              | `taylor@everwell.demo`   | Taylor Brooks  |
| MARKETING                               | `casey@everwell.demo`    | Casey Morgan   |
| STAFF (custom role: Clinic Coordinator) | `robin@everwell.demo`    | Robin Lee      |
| PROVIDER                                | `sarah@everwell.demo`    | Dr. Sarah Chen |
| PATIENT                                 | `emma@everwell.demo`     | Emma Hartwell  |

Other providers: `marcus@`, `priya@`, `james@everwell.demo`. 14 more patients exist (e.g. `liam@`, `sophia@`, `olivia@everwell.demo`).

**Worth pointing out:**

- Ports: frontend **3000**, backend **3001**, Postgres **5433**, Redis **6379**.
- Two known TypeScript errors exist in the landing components (framer-motion typing). They're suppressed by `typescript.ignoreBuildErrors` in `next.config.js` and don't affect the running app.
- The AI Front Desk lives at `/dashboard/voice-agent` and needs only `GROQ_API_KEY`. Its voice needs a one-time terms acceptance at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english — without it the agent still works, just with the browser's robotic voice.
- Run `/about` to get a tour of what MedoFlow is and how the codebase is laid out.

## Day-to-day (tell them this at the end)

```
# Start the stack
docker compose -f docker-compose.dev.yml up -d && docker start medoflow-redis
cd backend && pnpm dev      # terminal 1
cd frontend && pnpm dev     # terminal 2

# After pulling schema changes
cd backend && npx prisma db push && npx prisma generate
```

## Troubleshooting

| Symptom                                   | Fix                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Cannot connect to Docker daemon` (macOS) | Open Docker Desktop; or prefix with `DOCKER_HOST=unix://$HOME/.docker/run/docker.sock`                            |
| `EADDRINUSE :::3001`                      | `kill $(lsof -ti:3001)`                                                                                           |
| Webpack / chunk errors in the browser     | `rm -rf frontend/.next` and restart the frontend                                                                  |
| `PrismaClientInitializationError`         | Postgres isn't up — re-run the compose command; check `DATABASE_URL` uses port **5433**                           |
| Scribe stuck on "Processing"              | Redis isn't running — `docker start medoflow-redis`, then restart the backend                                     |
| Voice agent returns 502                   | Missing/expired `GROQ_API_KEY`, or the free-tier daily quota is exhausted                                         |
| Voice agent works but sounds robotic      | Groq TTS terms not accepted — accept at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english |
