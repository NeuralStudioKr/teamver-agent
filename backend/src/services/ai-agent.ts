/**
 * Teamver AI 자동응답 서비스 (EXTERNAL_BOTS_ENABLED=false 일 때만 쓰는 fallback).
 * 운영에서는 OpenClaw 컨테이너가 응답을 담당하므로 이 경로는 비활성.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const AI_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || "xiaomi/mimo-v2-omni"

const COORDINATOR_NAME = process.env.AI_COORDINATOR_NAME || "조율자"
const WRITER_NAME      = process.env.AI_WRITER_NAME      || "작성자"
const REVIEWER_NAME    = process.env.AI_REVIEWER_NAME    || "검토자"

const AGENT_PERSONAS: Record<string, { name: string; system: string }> = {
  "00000000-0000-0000-0000-000000000001": {
    name: COORDINATOR_NAME,
    system: `당신은 ${COORDINATOR_NAME} - 워크스페이스의 조율자 AI 직원입니다.
일정·요구사항·우선순위·리스크 조율 관점으로 답변합니다. 격식체를 사용하되 따뜻하게. 결론을 먼저 말하는 PM 스타일.`,
  },
  "00000000-0000-0000-0000-000000000002": {
    name: WRITER_NAME,
    system: `당신은 ${WRITER_NAME} - 워크스페이스의 작성자 AI 직원입니다.
결과물(설계·자료·초안·코드) 제작 관점에서 답변합니다. 정확하고 논리적이며, 근거를 명확히 제시합니다.`,
  },
  "00000000-0000-0000-0000-000000000003": {
    name: REVIEWER_NAME,
    system: `당신은 ${REVIEWER_NAME} - 워크스페이스의 검토자 AI 직원입니다.
결과물·논리 정합성 확인·반박·테스트·승인 관점에서 답변합니다. 간결하고 실용적이며, 다음 액션을 명확히 제시합니다.`,
  },
}

export async function generateAIResponse(
  agentId: string,
  channelContext: string,
  userMessage: string,
  userName: string
): Promise<string | null> {
  const persona = AGENT_PERSONAS[agentId]
  if (!persona || !OPENROUTER_API_KEY) return null

  try {
    const timeout = parseInt(process.env.AI_RESPONSE_TIMEOUT_MS || "15000")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_FALLBACK_MODEL,
        max_tokens: 500,
        messages: [
          { role: "system", content: persona.system },
          { role: "user", content: `${userName}: ${userMessage}` },
        ],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    const data = (await res.json()) as any
    return data?.choices?.[0]?.message?.content || null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ai-agent] 응답 생성 실패 (agentId=${agentId}):`, message)
    return null
  }
}

export function shouldAIRespond(agentId: string, message: string, isBot: boolean): boolean {
  if (isBot) return false
  const lower = message.toLowerCase()
  const mentioned =
    lower.includes(COORDINATOR_NAME.toLowerCase()) ||
    lower.includes(WRITER_NAME.toLowerCase()) ||
    lower.includes(REVIEWER_NAME.toLowerCase())
  if (mentioned) {
    const names: Record<string, string[]> = {
      "00000000-0000-0000-0000-000000000001": [COORDINATOR_NAME],
      "00000000-0000-0000-0000-000000000002": [WRITER_NAME],
      "00000000-0000-0000-0000-000000000003": [REVIEWER_NAME],
    }
    return (names[agentId] || []).some((n) => lower.includes(n.toLowerCase()))
  }
  return false
}
