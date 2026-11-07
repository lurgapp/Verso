#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# A backup contains server credentials, ownership digests and private storage data.
# Do not upload it to public object storage or include it in source control.
PROJECT_DIR="${VERSO_PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${VERSO_BACKUP_DIR:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${VERSO_BACKUP_RETENTION_DAYS:-14}"
QUIESCE="${BACKUP_QUIESCE:-1}"
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid backup retention.' >&2; exit 2; }
[[ "$QUIESCE" == 0 || "$QUIESCE" == 1 ]] || { echo 'BACKUP_QUIESCE must be 0 or 1.' >&2; exit 2; }
[[ -f "$PROJECT_DIR/.env" && -f "$PROJECT_DIR/compose.yml" ]] || { echo 'Project .env / compose.yml missing.' >&2; exit 2; }
mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo 'Another backup or restore is running.' >&2; exit 1; }
compose=(docker compose --project-directory "$PROJECT_DIR" --env-file "$PROJECT_DIR/.env" -f "$PROJECT_DIR/compose.yml")
if [[ -f "$PROJECT_DIR/compose.production.yml" && "${VERSO_STANDALONE:-0}" != 1 ]]; then compose+=(-f "$PROJECT_DIR/compose.production.yml"); fi
stage="$(mktemp -d "$BACKUP_DIR/.verso-backup.XXXXXX")"
app_was_running=0
storage_was_running=0
resume_services() {
  local result=$?
  trap - EXIT
  if [[ "$QUIESCE" == 1 ]]; then
    if [[ "$storage_was_running" == 1 ]]; then "${compose[@]}" start storage >/dev/null || result=1; fi
    if [[ "$app_was_running" == 1 ]]; then "${compose[@]}" start app >/dev/null || result=1; fi
  fi
  rm -rf -- "$stage"
  exit "$result"
}
trap resume_services EXIT

is_running() {
  local container
  container="$("${compose[@]}" ps --all --quiet "$1")"
  [[ -n "$container" && "$(docker inspect --format '{{.State.Running}}' "$container")" == true ]]
}
if [[ "$QUIESCE" == 1 ]]; then
  if is_running app; then app_was_running=1; fi
  if is_running storage; then storage_was_running=1; fi
  "${compose[@]}" stop --timeout 30 app >/dev/null
  "${compose[@]}" stop --timeout 30 storage >/dev/null
fi

echo 'Backing up Verso PostgreSQL and private media storage.'
"${compose[@]}" exec -T db sh -c 'exec pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$stage/database.dump"
storage_container="$("${compose[@]}" ps --all --quiet storage)"
[[ -n "$storage_container" ]] || { echo 'Verso storage container missing.' >&2; exit 1; }
mkdir -- "$stage/storage"
docker cp "$storage_container:/data/." "$stage/storage/"
cp -- "$PROJECT_DIR/.env" "$stage/environment.env"
chmod 600 "$stage/environment.env" "$stage/database.dump"
cp -- "$PROJECT_DIR/compose.yml" "$stage/compose.yml"
if [[ -f "$PROJECT_DIR/garage.toml" ]]; then cp -- "$PROJECT_DIR/garage.toml" "$stage/garage.toml"; chmod 600 "$stage/garage.toml"; fi
if [[ -f "$PROJECT_DIR/compose.production.yml" ]]; then cp -- "$PROJECT_DIR/compose.production.yml" "$stage/compose.production.yml"; fi
if [[ -f "$PROJECT_DIR/infra/Caddyfile" ]]; then cp -- "$PROJECT_DIR/infra/Caddyfile" "$stage/Caddyfile"; fi
app_container="$("${compose[@]}" ps --all --quiet app)"
app_image_id=unknown
if [[ -n "$app_container" ]]; then app_image_id="$(docker inspect --format '{{.Image}}' "$app_container")"; fi
cat > "$stage/manifest.txt" <<EOF
format=verso-backup-v1
created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
quiesced=$QUIESCE
database=database.dump
storage=storage
storage_engine=garage
environment=environment.env
postgres_major=16
app_image_id=$app_image_id
EOF
archive_name="verso-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -czf "$BACKUP_DIR/$archive_name.partial" -C "$stage" .
chmod 600 "$BACKUP_DIR/$archive_name.partial"
mv -- "$BACKUP_DIR/$archive_name.partial" "$BACKUP_DIR/$archive_name"
(cd -- "$BACKUP_DIR" && sha256sum "$archive_name" > "$archive_name.sha256")
# Only archives created by this script are subject to retention.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'verso-*.tar.gz' -mtime "+$RETENTION_DAYS" -print0 |
  while IFS= read -r -d '' expired; do rm -f -- "$expired" "$expired.sha256"; done
echo "Backup ready: $BACKUP_DIR/$archive_name (contains secrets; mode 600)."
