#!/usr/bin/env bash
# B0.6.4 — restore drill: prove the latest encrypted backup restores.
#
#   fetch (latest object under the prefix, or BACKUP_FILE) → age-decrypt with
#   BACKUP_AGE_IDENTITY → pg_restore into an EMPTY scratch database → checks:
#     - every migration recorded, none failed
#     - core tables have rows
#     - AuditLog append-only trigger present
#   Prints a short report; exits non-zero if any check fails.
#
# Env:
#   RESTORE_DATABASE_URL    scratch database (will be overwritten) — never production
#   BACKUP_AGE_IDENTITY     age private key file path, or the key itself (AGE-SECRET-KEY-…)
#   BACKUP_FILE             optional local .dump.age; otherwise the latest object in
#   BACKUP_BUCKET / BACKUP_S3_ENDPOINT / BACKUP_PREFIX (+ AWS_* credentials)
set -euo pipefail
: "${RESTORE_DATABASE_URL:?}" "${BACKUP_AGE_IDENTITY:?}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

identity="$BACKUP_AGE_IDENTITY"
if [[ "$identity" == AGE-SECRET-KEY-* ]]; then printf '%s\n' "$identity" > "$work/id.txt"; identity="$work/id.txt"; fi

if [ -n "${BACKUP_FILE:-}" ]; then
  src="$BACKUP_FILE"
else
  : "${BACKUP_BUCKET:?}" "${BACKUP_S3_ENDPOINT:?}"
  prefix="${BACKUP_PREFIX:-neon/medoflow}"
  latest="$(aws s3 ls "s3://${BACKUP_BUCKET}/${prefix}/" --endpoint-url "$BACKUP_S3_ENDPOINT" | awk '{print $4}' | grep '\.dump\.age$' | sort | tail -1)"
  [ -n "$latest" ] || { echo "no backups found under ${prefix}/"; exit 1; }
  aws s3 cp "s3://${BACKUP_BUCKET}/${prefix}/${latest}" "$work/backup.dump.age" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
  src="$work/backup.dump.age"
fi
echo "restoring: $src"
age -d -i "$identity" "$src" > "$work/backup.dump"
pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error -d "$RESTORE_DATABASE_URL" "$work/backup.dump"

q() { psql "$RESTORE_DATABASE_URL" -Atc "$1"; }
fail=0
check() { if [ "$2" = "ok" ]; then echo "  ✓ $1"; else echo "  ✗ $1 ($2)"; fail=1; fi; }
echo "checks:"
# A migration counts as failed only if it never completed (a failed attempt later resolved is fine).
failed_migrations="$(q 'select count(*) from (select migration_name from "_prisma_migrations" group by migration_name having not bool_or(finished_at is not null and rolled_back_at is null)) x')"
migrations="$(q 'select count(distinct migration_name) from "_prisma_migrations"')"
check "migrations recorded: $migrations, failed/rolled back: $failed_migrations" "$([ "$migrations" -gt 0 ] && [ "$failed_migrations" = 0 ] && echo ok || echo bad)"
for t in Tenant Clinic User Appointment; do
  n="$(q "select count(*) from \"$t\"")"
  check "$t rows: $n" "$([ "$n" -gt 0 ] && echo ok || echo empty)"
done
trigger="$(q "select count(*) from pg_trigger where tgname = 'auditlog_append_only_row'")"
check "AuditLog append-only trigger present" "$([ "$trigger" = 1 ] && echo ok || echo missing)"
[ "$fail" = 0 ] && echo "RESTORE DRILL PASSED $(date -u +%FT%TZ)" || { echo "RESTORE DRILL FAILED"; exit 1; }
