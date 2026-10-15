# Secrets inventory and rotation (B0.6.3)

All runtime secrets live in **Render environment variables** for `medoflow-backend` (the secret store for the API). CI secrets live in **GitHub Actions secrets** on `team-avo/MedoFlow`. The rest are **Cloudflare** secrets. Nothing secret is committed: `gitleaks` runs in CI over the full history, and every value in `render.yaml` is `sync: false` (prompted) or generated.

| Secret                                                       | Store  | Rotation                                         | Notes                                                            |
| ------------------------------------------------------------ | ------ | ------------------------------------------------ | ---------------------------------------------------------------- |
| `JWT_SECRET`                                                 | Render | 90 days, or immediately on suspicion             | Zero-downtime rotation below. Boot rejects weak values           |
| `JWT_SECRET_PREVIOUS`                                        | Render | Only during a rotation window (≤ 7 days)         | Then remove it                                                   |
| `MFA_ENCRYPTION_KEY`                                         | Render | On suspicion only                                | Changing it invalidates enrolled TOTP secrets, so users re-enrol |
| `DATABASE_URL` (medoflow_app)                                | Render | 90 days                                          | `ALTER ROLE medoflow_app WITH PASSWORD '…'`, then update Render  |
| `MIGRATION_DATABASE_URL`, `AUDIT_PURGE_DATABASE_URL` (owner) | Render | 90 days                                          | Neon console › Roles › Reset password                            |
| `REDIS_URL`                                                  | Render | 90 days                                          | Redis Cloud › Database › Security                                |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (R2)             | Render | 90 days                                          | R2 › Manage API tokens. Create new → deploy → delete old         |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                 | Render | Yearly / on suspicion                            | Stripe › Developers › API keys / Webhooks › Roll secret          |
| `GROQ_API_KEY`                                               | Render | Yearly                                           | Voice agent (Component 10)                                       |
| `ALERT_WEBHOOK_URL`                                          | Render | On suspicion                                     | Slack › Incoming webhooks                                        |
| `RENDER_DEPLOY_HOOK_URL`, `CLOUDFLARE_API_TOKEN`             | GitHub | Yearly                                           |                                                                  |
| `BACKUP_*`                                                   | GitHub | Yearly. The age identity is kept offline as well |                                                                  |

## Zero-downtime JWT rotation (the rotation demonstration)

1. Generate a new value: `openssl rand -hex 32`.
2. In Render, set `JWT_SECRET_PREVIOUS` = the current `JWT_SECRET`, and `JWT_SECRET` = the new value. Save, then deploy.
3. Verify: a token issued before the change still works (`GET /api/v1/auth/me` → 200), and a fresh login works. Tokens are verified against the current secret first, then the previous one; new tokens are always signed with the current one.
4. After 7 days (refresh-token lifetime), delete `JWT_SECRET_PREVIOUS` and deploy. The old secret is now dead.
5. Record the rotation date below.

Covered by `authSafeguards.int.test.ts` › "a token signed with the previous secret is accepted during rotation, and rejected after".

## Rotation log

| Date | Secret | By  | Verified (how) |
| ---- | ------ | --- | -------------- |
|      |        |     |                |
