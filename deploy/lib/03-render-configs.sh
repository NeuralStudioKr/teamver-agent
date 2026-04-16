#!/usr/bin/env bash
# 03-render-configs.sh — customer JSON + 생성된 시크릿으로 .env 렌더링
# 출력: $STAGING_DIR/.env (다음 스텝에서 VPS로 업로드)

set -euo pipefail
: "${CUSTOMER_JSON:?}"
: "${STAGING_DIR:?}"
: "${REPO_ROOT:?}"

mkdir -p "$STAGING_DIR"
TPL="${REPO_ROOT}/deploy/templates/.env.tpl"
OUT="${STAGING_DIR}/.env"
SECRETS_FILE="${STAGING_DIR}/secrets.json"

# 이미 생성된 시크릿이 있으면 재사용, 없으면 새로 생성
if [[ -f "$SECRETS_FILE" ]]; then
  echo "• 기존 secrets.json 재사용"
  JWT_SECRET=$(jq -r '.jwt_secret' "$SECRETS_FILE")
  POSTGRES_PASSWORD=$(jq -r '.postgres_password' "$SECRETS_FILE")
  BOT_PASSWORD=$(jq -r '.bot_password' "$SECRETS_FILE")
else
  JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')
  POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')
  BOT_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')
  jq -n --arg j "$JWT_SECRET" --arg p "$POSTGRES_PASSWORD" --arg b "$BOT_PASSWORD" \
    '{jwt_secret:$j, postgres_password:$p, bot_password:$b}' > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  echo "• 신규 secrets.json 생성: $SECRETS_FILE (권한 0600)"
fi

# customer JSON에서 값 추출
j() { jq -r "$1" "$CUSTOMER_JSON"; }

CID=$(j '.customer.id')
WS_NAME=$(j '.customer.display_name')
WS_SLUG=$(j '.customer.slug // .customer.id')

OPENROUTER=$(j '.secrets.openrouter_api_key')
ANTHROPIC=$(j '.secrets.anthropic_api_key // ""')

VPS_IP=$(j '.vps.ip')
BACKEND_PORT=$(j '.ports.backend // 3101')
FRONTEND_PORT=$(j '.ports.frontend // 3100')

MAIL_ENABLED=$(j '.mail_server.enabled // false')
MAIL_DOMAIN=$(j '.mail_server.domain // "teamver.online"')

# NEXT_PUBLIC_API_URL — Caddy가 api.{id}.{domain}으로 HTTPS 프록시 예정.
# 07-caddy.sh가 동일 변수 조합을 사용하므로 일관성 유지.
API_URL="https://api.${CID}.${MAIL_DOMAIN}"

# AI 3명 — email 완성 (local + @domain)
c_name=$(j '.ai_employees.coordinator.name')
c_title=$(j '.ai_employees.coordinator.title')
c_local=$(j '.ai_employees.coordinator.email_local')
c_model=$(j '.ai_employees.coordinator.model // "anthropic/claude-haiku-4-5"')
c_cust=$(j '.ai_employees.coordinator.custom_prompt // ""')

w_name=$(j '.ai_employees.writer.name')
w_title=$(j '.ai_employees.writer.title')
w_local=$(j '.ai_employees.writer.email_local')
w_model=$(j '.ai_employees.writer.model // "anthropic/claude-haiku-4-5"')
w_cust=$(j '.ai_employees.writer.custom_prompt // ""')

r_name=$(j '.ai_employees.reviewer.name')
r_title=$(j '.ai_employees.reviewer.title')
r_local=$(j '.ai_employees.reviewer.email_local')
r_model=$(j '.ai_employees.reviewer.model // "anthropic/claude-haiku-4-5"')
r_cust=$(j '.ai_employees.reviewer.custom_prompt // ""')

c_email="${c_local}@${MAIL_DOMAIN}"
w_email="${w_local}@${MAIL_DOMAIN}"
r_email="${r_local}@${MAIL_DOMAIN}"

# 안전한 sed escape (슬래시·앰퍼샌드·백슬래시 이스케이프)
esc() { printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g' -e 's/$/\\n/' | tr -d '\n' | sed 's/\\n$//'; }

cp "$TPL" "$OUT"
sed -i \
  -e "s|__JWT_SECRET__|$(esc "$JWT_SECRET")|" \
  -e "s|__POSTGRES_PASSWORD__|$(esc "$POSTGRES_PASSWORD")|" \
  -e "s|__BOT_PASSWORD__|$(esc "$BOT_PASSWORD")|" \
  -e "s|__OPENROUTER_API_KEY__|$(esc "$OPENROUTER")|" \
  -e "s|__ANTHROPIC_API_KEY__|$(esc "$ANTHROPIC")|" \
  -e "s|__WORKSPACE_NAME__|$(esc "$WS_NAME")|" \
  -e "s|__WORKSPACE_SLUG__|$(esc "$WS_SLUG")|" \
  -e "s|__COORDINATOR_NAME__|$(esc "$c_name")|" \
  -e "s|__COORDINATOR_TITLE__|$(esc "$c_title")|" \
  -e "s|__COORDINATOR_EMAIL__|$(esc "$c_email")|" \
  -e "s|__COORDINATOR_MODEL__|$(esc "$c_model")|" \
  -e "s|__COORDINATOR_CUSTOM_PROMPT__|$(esc "$c_cust")|" \
  -e "s|__WRITER_NAME__|$(esc "$w_name")|" \
  -e "s|__WRITER_TITLE__|$(esc "$w_title")|" \
  -e "s|__WRITER_EMAIL__|$(esc "$w_email")|" \
  -e "s|__WRITER_MODEL__|$(esc "$w_model")|" \
  -e "s|__WRITER_CUSTOM_PROMPT__|$(esc "$w_cust")|" \
  -e "s|__REVIEWER_NAME__|$(esc "$r_name")|" \
  -e "s|__REVIEWER_TITLE__|$(esc "$r_title")|" \
  -e "s|__REVIEWER_EMAIL__|$(esc "$r_email")|" \
  -e "s|__REVIEWER_MODEL__|$(esc "$r_model")|" \
  -e "s|__REVIEWER_CUSTOM_PROMPT__|$(esc "$r_cust")|" \
  -e "s|__VPS_IP__|$(esc "$VPS_IP")|" \
  -e "s|__BACKEND_PORT__|$(esc "$BACKEND_PORT")|" \
  -e "s|__API_URL__|$(esc "$API_URL")|" \
  "$OUT"

chmod 600 "$OUT"
echo "• 렌더 완료: $OUT"

# 미해결 플레이스홀더 탐지
if grep -n "__[A-Z_]*__" "$OUT"; then
  echo "❌ 미해결 플레이스홀더 남아있음"; exit 1
fi

echo "✅ 03-render-configs PASS"
