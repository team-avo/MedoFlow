#!/usr/bin/env bash
# B0.6.4 — encrypted database backup.
#
#   pg_dump (custom format) → age-encrypt to BACKUP_AGE_RECIPIENT → upload to the
#   private backup bucket. The plaintext dump never touches disk; only the
#   holder of the age identity (private key, kept offline / in the password
#   manager) can read a backup.
#
# Env:
#   BACKUP_DATABASE_URL     owner/read-only connection string (direct, not pooler)
#   BACKUP_AGE_RECIPIENT    age public key (age1…)
#   BACKUP_BUCKET           e.g. medoflow-backups (R2, private, lifecycle rule = retention)
#   BACKUP_S3_ENDPOINT      e.g. https://<account>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   R2 token scoped to BACKUP_BUCKET
#   BACKUP_PREFIX           optional, default "neon/medoflow"
#   BACKUP_LOCAL_DIR        optional: write the encrypted file here instead of uploading (drills/tests)
set -euo pipefail
: "${BACKUP_DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}"
prefix="${BACKUP_PREFIX:-neon/medoflow}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="medoflow-${stamp}.dump.age"

if [ -n "${BACKUP_LOCAL_DIR:-}" ]; then
  mkdir -p "$BACKUP_LOCAL_DIR"
  out="$BACKUP_LOCAL_DIR/$name"
  pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" > "$out"
else
  : "${BACKUP_BUCKET:?}" "${BACKUP_S3_ENDPOINT:?}"
  out="s3://${BACKUP_BUCKET}/${prefix}/${name}"
  pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" \
    | age -r "$BACKUP_AGE_RECIPIENT" \
    | aws s3 cp - "$out" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
fi
echo "backup written: $out"
