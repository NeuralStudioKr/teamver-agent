#!/usr/bin/env bash
# deploy.sh — Teamstack 고객사 1개를 VPS에 배포 (end-to-end).
# Usage: ./deploy.sh <customer.json>
#
# customer.json 스키마는 deploy/customer.example.json 참조.
# 자세한 절차·트러블슈팅은 deploy/DEPLOY_MANUAL.md 참조.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  cat <<EOF
Usage: $0 <customer.json>

Example:
  $0 ./customers/acme.json

See deploy/DEPLOY_MANUAL.md for the full procedure.
EOF
  exit 1
fi

CUSTOMER_JSON="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[[ -f "$CUSTOMER_JSON" ]] || { echo "not found: $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CID=$(jq -r '.customer.id' "$CUSTOMER_JSON")
STAGING_DIR="${SCRIPT_DIR}/staging/${CID}"
mkdir -p "$STAGING_DIR"

export CUSTOMER_JSON REPO_ROOT SCRIPT_DIR STAGING_DIR

echo "================================================"
echo " Teamstack deploy — customer: $CID"
echo " staging: $STAGING_DIR"
echo "================================================"

STEPS=(
  "00-dns"
  "01-validate"
  "02-remote-prep"
  "03-render-configs"
  "04-mailboxes"
  "05-upload-and-up"
  "06-verify"
  "07-caddy"
)

for step in "${STEPS[@]}"; do
  echo ""
  echo "—— $step ——"
  if ! bash "${SCRIPT_DIR}/lib/${step}.sh"; then
    echo ""
    echo "❌ FAIL at $step"
    echo "   staging 디렉토리는 보존됨: $STAGING_DIR"
    echo "   원인 해결 후 동일 명령 재실행하면 진행된 스텝은 skip (멱등)."
    exit 1
  fi
done

echo ""
echo "🎉 전체 배포 성공: $CID"
