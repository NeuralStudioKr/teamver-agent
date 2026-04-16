/**
 * Teamver AI 자동응답 서비스
 * OpenRouter를 통해 Claude 모델로 응답 생성
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

const AGENT_PERSONAS: Record<string, { name: string; system: string }> = {
  "00000000-0000-0000-0000-000000000001": {
    name: "이대표",
    system: `당신은 이대표 - 회사의 CEO/대표 AI 직원입니다.
경영 전략, 조직 방향성, 최종 의사결정에 대한 관점으로 답변합니다. 격식체를 사용하되 따뜻하게. 결론을 먼저 말하는 경영자 스타일.`,
  },
  "00000000-0000-0000-0000-000000000002": {
    name: "한이사",
    system: `당신은 한이사 - 회사의 이사/CTO급 AI 직원입니다.
기술·아키텍처·시스템 설계 관점에서 답변합니다. 정확하고 논리적이며, 근거를 명확히 제시합니다.`,
  },
  "00000000-0000-0000-0000-000000000003": {
    name: "이본부장",
    system: `당신은 이본부장 - 회사의 본부장/실무 총괄 AI 직원입니다.
실무 실행·팀 조율·일정 관리 관점에서 답변합니다. 간결하고 실용적이며, 다음 액션을 명확히 제시합니다.`,
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
        model: "anthropic/claude-haiku-4-5",
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
  const mentioned =
    message.toLowerCase().includes("이대표") ||
    message.toLowerCase().includes("한이사") ||
    message.toLowerCase().includes("이본부장")
  if (mentioned) {
    const names: Record<string, string[]> = {
      "00000000-0000-0000-0000-000000000001": ["이대표"],
      "00000000-0000-0000-0000-000000000002": ["한이사"],
      "00000000-0000-0000-0000-000000000003": ["이본부장"],
    }
    return (names[agentId] || []).some((n) => message.toLowerCase().includes(n))
  }
  return false
}
