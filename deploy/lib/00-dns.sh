#!/usr/bin/env bash
# 00-dns.sh — Porkbun API로 customer 서브도메인 A 레코드 2건 생성 (멱등)
#  {customer.id}.{domain}           → VPS IP  (프런트)
#  api.{customer.id}.{domain}       → VPS IP  (백엔드)
#
# 필요 env:
#   PORKBUN_API_KEY, PORKBUN_API_SECRET  (SECRETS.local.md §3.3)
# 없으면 이 스텝은 스킵된다 (판매자가 수동 생성).

set -euo pipefail
: "${CUSTOMER_JSON:?}"

if [[ -z "${PORKBUN_API_KEY:-}" || -z "${PORKBUN_API_SECRET:-}" ]]; then
  echo "• PORKBUN_API_KEY/SECRET env 없음 → DNS 스텝 스킵"
  echo "  수동으로 A 레코드 2개(${SUBDOMAIN}, api.${SUBDOMAIN})를 VPS IP로 생성해두세요."
  echo "✅ 00-dns SKIP"
  exit 0
fi

SUBDOMAIN=$(jq -r '.customer.id' "$CUSTOMER_JSON")
DOMAIN_SUFFIX=$(jq -r '.mail_server.domain // "teamver.online"' "$CUSTOMER_JSON")
VPS_IP=$(jq -r '.vps.ip' "$CUSTOMER_JSON")

ensure_record() {
  local name="$1"
  local full="${name}.${DOMAIN_SUFFIX}"

  local existing
  existing=$(curl -sf -X POST "https://api.porkbun.com/api/json/v3/dns/retrieveByNameType/${DOMAIN_SUFFIX}/A/${name}" \
    -H "Content-Type: application/json" \
    -d "{\"apikey\":\"${PORKBUN_API_KEY}\",\"secretapikey\":\"${PORKBUN_API_SECRET}\"}" \
    | jq -r '.records[0].content // empty')

  if [[ "$existing" == "$VPS_IP" ]]; then
    echo "  ${full} → ${VPS_IP} 이미 동일"
    return
  fi

  if [[ -n "$existing" ]]; then
    echo "  ⚠️  ${full} 기존 값 ${existing} ≠ ${VPS_IP} — 수동 갱신 필요 (Porkbun 콘솔)"
    return
  fi

  local resp
  resp=$(curl -sf -X POST "https://api.porkbun.com/api/json/v3/dns/create/${DOMAIN_SUFFIX}" \
    -H "Content-Type: application/json" \
    -d "{\"apikey\":\"${PORKBUN_API_KEY}\",\"secretapikey\":\"${PORKBUN_API_SECRET}\",\"name\":\"${name}\",\"type\":\"A\",\"content\":\"${VPS_IP}\",\"ttl\":\"600\"}" \
    | jq -r '.status // "?"')
  if [[ "$resp" == "SUCCESS" ]]; then
    echo "  ${full} → ${VPS_IP} 신규 생성"
  else
    echo "  ❌ ${full} 생성 실패 (Porkbun resp=${resp})"
    return 1
  fi
}

ensure_record "$SUBDOMAIN"
ensure_record "api.${SUBDOMAIN}"

# 간이 전파 확인 (1.1.1.1 기준, 10초 내 보통 반영)
echo "• DNS 전파 대기 (최대 30s)"
for i in $(seq 1 15); do
  if dig +short A "${SUBDOMAIN}.${DOMAIN_SUFFIX}" @1.1.1.1 | grep -q "$VPS_IP"; then
    echo "  ${SUBDOMAIN}.${DOMAIN_SUFFIX} 전파됨"
    break
  fi
  sleep 2
done

echo "✅ 00-dns PASS"
