#!/usr/bin/env bash
# 06-verify.sh — VPS 스택 건전성 확인. 봇 3명이 online이면 PASS.

set -euo pipefail
: "${CUSTOMER_JSON:?}"

VPS_IP=$(jq -r '.vps.ip' "$CUSTOMER_JSON")
VPS_USER=$(jq -r '.vps.ssh_user // "root"' "$CUSTOMER_JSON")
VPS_PORT=$(jq -r '.vps.ssh_port // 22' "$CUSTOMER_JSON")
BACKEND_PORT=$(jq -r '.ports.backend // 3101' "$CUSTOMER_JSON")
FRONTEND_PORT=$(jq -r '.ports.frontend // 3100' "$CUSTOMER_JSON")

CID=$(jq -r '.customer.id' "$CUSTOMER_JSON")
WS_NAME=$(jq -r '.customer.display_name' "$CUSTOMER_JSON")
C_NAME=$(jq -r '.ai_employees.coordinator.name' "$CUSTOMER_JSON")
W_NAME=$(jq -r '.ai_employees.writer.name' "$CUSTOMER_JSON")
R_NAME=$(jq -r '.ai_employees.reviewer.name' "$CUSTOMER_JSON")

# backend 헬스 (VPS에서 localhost로 체크)
echo "• backend health 폴링 (최대 60s)"
for i in $(seq 1 30); do
  if ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_IP}" \
       "curl -fs -m 3 http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "  backend ready"
    break
  fi
  sleep 2
done

# 3 봇 컨테이너 상태
echo "• 컨테이너 상태"
ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_IP}" \
  "docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'ta-(postgres|backend|frontend|ai-)'"

# 봇 WS 연결 확인
echo "• 3 봇 WebSocket 연결 확인"
for c in ta-ai-coordinator ta-ai-writer ta-ai-reviewer; do
  if ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_IP}" \
       "docker logs $c --tail 20 2>&1 | grep -q 'socket connected'"; then
    echo "  ✓ $c socket connected"
  else
    echo "  ❌ $c 연결 흔적 없음 (로그:)"
    ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_IP}" "docker logs $c --tail 10"
    exit 1
  fi
done

# DB에 3 봇이 올바른 이름으로 시드됐는지
echo "• DB AI 직원 이름 검증"
DB_CHECK=$(ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_IP}" \
  "docker exec ta-postgres psql -U teamver -d teamver_agent -tA -c \"SELECT name FROM users WHERE is_bot=true ORDER BY id\"")
EXPECTED="${C_NAME}
${W_NAME}
${R_NAME}"
if [[ "$DB_CHECK" == "$EXPECTED" ]]; then
  echo "  ✓ DB seeded: $C_NAME / $W_NAME / $R_NAME"
else
  echo "  ❌ DB seed 불일치"
  echo "  기대: $EXPECTED"
  echo "  실제: $DB_CHECK"
  exit 1
fi

DOMAIN_SUFFIX=$(jq -r '.mail_server.domain // "teamver.online"' "$CUSTOMER_JSON")
FRONT_DOMAIN="${CID}.${DOMAIN_SUFFIX}"
API_DOMAIN="api.${CID}.${DOMAIN_SUFFIX}"

cat <<SUMMARY

✅ 배포 완료: $WS_NAME ($CID)

  Frontend (공용 URL):   https://${FRONT_DOMAIN}
  Backend  (공용 URL):   https://${API_DOMAIN}
  Frontend (직접 IP):    http://${VPS_IP}:${FRONTEND_PORT}
  Backend  (직접 IP):    http://${VPS_IP}:${BACKEND_PORT}

  AI 직원 3명 온라인:
    • $C_NAME (조율자)
    • $W_NAME (작성자)
    • $R_NAME (검수자)

  첫 가입자가 admin 권한을 가집니다. 고객에게 https://${FRONT_DOMAIN} 을 전달하세요.

SUMMARY
echo "✅ 06-verify PASS"
