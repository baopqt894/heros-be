#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run under the service account with secrets supplied by the job environment.
: "${SOS_RECORDINGS_DIR:?Set the absolute persistent recording directory}"
: "${RESTIC_REPOSITORY:?Set an encrypted off-host restic repository}"
: "${RESTIC_PASSWORD_FILE:?Set the protected restic password file}"
[[ "$SOS_RECORDINGS_DIR" = /* && -d "$SOS_RECORDINGS_DIR" ]] || { printf '%s\n' 'Invalid recording directory' >&2; exit 1; }
command -v restic >/dev/null
restic backup --tag heros-recordings "$SOS_RECORDINGS_DIR"
restic check
printf '%s\n' 'HEROS_RECORDING_BACKUP_SUCCEEDED'
