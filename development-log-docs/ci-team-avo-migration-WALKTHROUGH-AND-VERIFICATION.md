# CI/CD move to team-avo/MedoFlow `development`: walkthrough and verification

**Date:** 2026-10-15 · **Branch:** `ci/team-avo-development` (from `feat/c1-scheduling` @ `d895341`) · **PR:** team-avo PR #5, stacked on #3

The deploying repo is now **`team-avo/MedoFlow`**, branch **`development`**, which is also the repo's default branch. Before this change, CI only deployed from `myselfabhi/MedoFlow` `main`, so merges into the org repo deployed nothing.

---

## 1. What changed

| File                                      | Change                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/deploy.yml`            | Triggers on PRs into, and pushes to, `development` (was `main`). The deploy jobs' repo guard and `DEPLOY_REPO` are now `team-avo/MedoFlow`. Concurrency group `deploy-development`. Header comments updated. |
| `.github/workflows/db-backup.yml`         | Repo guard is now `team-avo/MedoFlow`. Scheduled runs use the copy on the default branch (`development`).                                                                                                    |
| `render.yaml`                             | The header notes that the Render service must be connected to `team-avo/MedoFlow` / `development`. Otherwise the deploy hook's `?ref=<sha>` can't resolve.                                                   |
| `.claude/commands/setup.md`               | Clone from `team-avo/MedoFlow` and open PRs into `development`.                                                                                                                                              |
| `docs/SECRETS_AND_ROTATION.md`            | CI secrets now live on `team-avo/MedoFlow`.                                                                                                                                                                  |
| `development-log-docs/*` (Part 0, B0, F0) | Forward-looking steps (PR target, branch protection, owner setup, manual deploy) now point at team-avo `development`. Historical records (runs, merges, "live code @ 379818c") stay as written.              |

The pipeline itself hasn't changed. A PR runs the backend gate, the frontend gate and the build, with no secrets and no deploy. A push or merge to `development` runs the same gates, deploys whichever app changed (Render hook pinned to the SHA, then `wrangler deploy` of the built OpenNext bundle) and smoke-checks it. Running the workflow by hand deploys both apps.

## 2. Owner setup (needs a team-avo/MedoFlow **admin**)

Until step 1 is done, `deploy-frontend` stops on purpose with "… is not set". The gates still run.

1. **Environment `medoflow-dev-env`** (Settings › Environments › medoflow-dev-env). `deploy-frontend` runs in this environment, so its settings go here, not at repo level:
   - Secrets: `CLOUDFLARE_API_TOKEN` (a token with Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID` (`523c0186a1808be62e718907053c513b`)
   - Variables: `BACKEND_URL=https://medoflow-backend-6pd5.onrender.com` (no trailing slash), `FRONTEND_URL=https://medoflow-web.advertout-medoflow.workers.dev`, and optionally `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - If a deployment-branch rule is set, it must allow `development`.
2. **Repository-level secrets** (Settings › Secrets and variables › Actions), for `db-backup.yml`, which has no environment: `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, plus the variable `BACKUP_BUCKET`.
3. **Render**: medoflow-backend is connected to `team-avo/MedoFlow` / `development` with **auto-deploy on**. Render deploys the backend itself. The CI `deploy-backend` job is commented out in `deploy.yml`. To deploy only commits that passed the gates, re-enable it with `environment: medoflow-dev-env`, add `RENDER_DEPLOY_HOOK_URL` to the environment, and turn Render auto-deploy off.
4. The empty `production` environment that GitHub auto-created is no longer used and can be deleted.
5. **Branch protection on `development`**: require a PR and the status checks **Backend quality gate**, **Frontend quality gate** and **Build**, with branches kept up to date.
6. ⚠️ **The repo is public.** Confirm that's intended for this codebase. The data is synthetic only (see [PHI gate](../docs/PHI_GATE.md)), and `gitleaks` scans the history in CI. PR runs from forks never get secrets.

## 3. Merge order

PRs into `development` are stacked: **#1 B0 → #2 F0 → #3 C1 → #5 this**. After each merge, GitHub retargets the next PR to `development`. Merging #1–#3 alone deploys nothing, because those branches still carry the `myselfabhi/MedoFlow` guard. Deploys start once #5 is in `development`.

## 4. Verification

```bash
grep -rn "myselfabhi" .github render.yaml docs .claude/commands
#  → no matches
grep -n "branches: \[" .github/workflows/deploy.yml
#  → push and pull_request both: [development]
```

After the owner setup and the PR #5 merge:

```bash
gh run list --repo team-avo/MedoFlow --workflow "CI / Deploy" --limit 3
#  → the merge run: gates ✓, deploy-frontend builds with the Render URL, `wrangler deploy` succeeds, smoke "/ → 200"
gh workflow run "CI / Deploy" --repo team-avo/MedoFlow --ref development   # manual: deploys the frontend
gh workflow run "DB backup" --repo team-avo/MedoFlow --ref development      # backup + restore drill
```

Branch protection check: open a throwaway PR into `development` with a failing test. The gate fails and Merge is blocked.

## 5. Fix: deploy jobs could not see the environment (2026-10-15)

The first push run on `development` (38760356025) passed all gates, but `deploy-frontend` failed with "BACKEND_URL variable is not set".

- The values were in the environment `medoflow-dev-env`, but the job declared `environment: production`, which GitHub auto-created empty.
- The bundle was built in the `build` job, which has no environment. So `NEXT_PUBLIC_API_URL` would have been inlined as `http://localhost:3001` even with matching names.

Changes in `deploy.yml`:

- `deploy-frontend` now uses `environment: medoflow-dev-env` and runs `cf:build` itself with `vars.BACKEND_URL` before `wrangler deploy`.
- The `build` job keeps `cf:build` as a PR build gate only, against `localhost`. The artifact upload and download are gone.
- `deploy-backend` stays commented out, because Render auto-deploys.
