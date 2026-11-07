#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Destructive only to this Verso deployment. Operator must explicitly opt in.
[[ "${RESTORE_CONFIRM:-}" == RESTORE ]] || { echo 'Set RESTORE_CONFIRM=RESTORE after reviewing docs/backup.md.' >&2; exit 2; }
[[ $# == 1 && -f "$1" ]] || { echo 'Usage: RESTORE_CONFIRM=RESTORE ./scripts/restore.sh /private/verso-backup.tar.gz' >&2; exit 2; }
PROJECT_DIR="${VERSO_PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${VERSO_BACKUP_DIR:-${PROJECT_DIR}/backups}"
archive="$(realpath -- "$1")"
[[ -f "$PROJECT_DIR/.env" && -f "$PROJECT_DIR/compose.yml" ]] || { echo 'Project .env / compose.yml missing.' >&2; exit 2; }
mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo 'Another backup or restore is running.' >&2; exit 1; }
if [[ -f "$archive.sha256" ]]; then
  (cd -- "$(dirname -- "$archive")" && sha256sum --check --status "$(basename -- "$archive").sha256") || { echo 'Backup checksum mismatch.' >&2; exit 1; }
else
  echo 'Checksum sidecar missing; refusing an unverified archive.' >&2
  exit 1
fi
stage="$(mktemp -d "$BACKUP_DIR/.verso-restore.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
# Reject archive path traversal, symlinks, hardlinks and device members.
python3 - "$archive" "$stage" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe backup member; restore aborted.')
    archive.extractall(sys.argv[2], filter='data')
PY
[[ -s "$stage/database.dump" && -f "$stage/environment.env" && -d "$stage/storage" && -f "$stage/garage.toml" && -f "$stage/manifest.txt" ]] || { echo 'Incomplete Verso backup.' >&2; exit 1; }
[[ "$(sed -n 's/^format=//p' "$stage/manifest.txt")" == verso-backup-v1 ]] || { echo 'Unsupported backup format.' >&2; exit 1; }
compose=(docker compose --project-directory "$PROJECT_DIR" --env-file "$PROJECT_DIR/.env" -f "$PROJECT_DIR/compose.yml")
if [[ -f "$PROJECT_DIR/compose.production.yml" && "${VERSO_STANDALONE:-0}" != 1 ]]; then compose+=(-f "$PROJECT_DIR/compose.production.yml"); fi
echo 'Stopping only the Verso app and storage for restore.'
"${compose[@]}" stop --timeout 30 app
"${compose[@]}" stop --timeout 30 storage
# Keep the original environment as a private rollback artifact.
cp -- "$PROJECT_DIR/.env" "$BACKUP_DIR/environment-before-restore-$(date -u +%Y%m%dT%H%M%SZ).env"
install -m 600 -- "$stage/environment.env" "$PROJECT_DIR/.env"
install -m 600 -- "$stage/garage.toml" "$PROJECT_DIR/garage.toml"
storage_container="$("${compose[@]}" ps --all --quiet storage)"
[[ -n "$storage_container" ]] || { echo 'Verso storage container missing.' >&2; exit 1; }
# Work through the attached volume. A tiny helper avoids touching host-global volumes.
docker run --rm --network none --volumes-from "$storage_container" --entrypoint /bin/sh alpine:3.22 -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
docker cp "$stage/storage/." "$storage_container:/data/"
"${compose[@]}" exec -T db sh -c 'exec pg_restore --clean --if-exists --single-transaction --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' < "$stage/database.dump"
"${compose[@]}" up -d --force-recreate storage app
echo 'Restore completed. Verify /api/health, an old article, an image and owner editing before reopening traffic.'
