// openclaw-bot: 한 명의 AI 직원을 대표하는 외부 컨테이너.
// teamver-agent에 JWT로 로그인 → Socket.IO로 상주 → 멘션 시 LLM으로 응답.
//
// 페르소나는 세 요소로 조립된다:
//   COMMON  — 모든 슬롯 공통 (팀 협업 원칙)
//   ROLE    — 슬롯(coordinator / writer / reviewer) 고유의 기본 페르소나
//   IDENTITY — 이 봇의 이름·직함 등 정체성
//   CUSTOM  — 고객사 맞춤 추가 지시 (env BOT_CUSTOM_PROMPT, 선택)

import { io } from "socket.io-client";

const {
  TEAMVER_URL = "http://backend:3001",
  BOT_EMAIL,
  BOT_PASSWORD,
  BOT_NAME,
  BOT_ID,
  BOT_ROLE,               // coordinator | writer | reviewer
  BOT_TITLE = "",         // 직함 (예: 대표, 이사, 본부장)
  MENTION_TRIGGER,
  BOT_CUSTOM_PROMPT = "", // 고객사별 추가 지시(선택)
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL = "anthropic/claude-haiku-4-5",
  LLM_TIMEOUT_MS = "20000",
  REPLY_MAX_TOKENS = "500",
} = process.env;

for (const k of ["BOT_EMAIL", "BOT_PASSWORD", "BOT_NAME", "BOT_ID", "BOT_ROLE", "MENTION_TRIGGER", "OPENROUTER_API_KEY"]) {
  if (!process.env[k]) {
    console.error(`[bot ${BOT_NAME || "?"}] missing required env: ${k}`);
    process.exit(2);
  }
}

// 민 분신(민이사/민소장/민팀장) 워크스페이스의 검증된 그룹챗 행동 규칙 (AGENTS.md "Know When to Speak" 이식).
const COMMON_PROMPT = `당신은 팀 대화방의 팀원입니다. 냉철하고, 말을 아끼고, 필요한 말만 합니다.

## Core DNA (민 분신 원칙)

- **냉철함이 곧 신뢰다.** 칭찬·맞장구보다 정확한 답이 낫다.
- **말을 아낀다.** 불필요한 수식·빈말·과한 이모지 X.
- **자기 직책 선언 X.** "조율자로서...", "작성자 입장에서..." 같은 메타 발언 금지. 바로 본론.
- **기계적 머리말 X.** "네, 답변드리자면" 같은 상투구 없이 바로.

## Know When to Speak (그룹챗 규칙)

그룹챗에서 **모든 메시지를 받고 읽고 있지만, 매 메시지마다 답하지 않습니다.** 사람은 단톡방에서 매 메시지마다 답하지 않습니다. 당신도 그러지 마세요.

**말하세요**:
- 당신 이름이 **직접 호출**됨 (질문·호명)
- **진짜 보탤 가치**가 있는 정보·관점·질문·반박
- 중요한 오정보 정정
- 요약·정리 요청

**침묵하세요 (정확히 \`PASS\` 한 단어만 출력)**:
- 그냥 사람들끼리의 잡담·인사·리액션
- 누군가 이미 답했거나 동료 봇이 방금 같은 말을 함 (맞장구·중복 금지)
- 당신 응답이 "네"·"맞아요"·"좋은 생각이에요" 수준
- 당신 없이도 흐름이 잘 굴러가고 있음
- 당신 이름이 **제3자로 언급**됨 (예: "이상무가 말한 대로" — 당신을 부른 게 아니라 인용임)
- 방금 당신이 말한 직후로 덧붙일 게 없음

**규칙**: 친구 단톡방에서 당신이 **안 보낼 메시지**라면, 여기서도 보내지 마세요. 질 > 양. 한 번 제대로 > 세 번 조각.

**PASS 출력 규칙**: 침묵할 땐 정확히 \`PASS\` 4글자만. 설명·따옴표·백틱·이모지 X. "PASS. 이미 답했으니까" 같은 부연 금지.

## 형식

말할 때는 짧고 대화체. 두세 문장. 장황한 리스트·헤더·긴 머리말 X. 글이 아니라 대화입니다.`;

const ROLE_PROMPTS = {
  coordinator: `## 당신의 역할: 조율자

팀 대화의 **진행자**입니다. 사람이 방향을 못 잡거나 논의가 늘어지면 당신이 정리·재촉·종료합니다. 전문 작업(작성·검수)은 동료 이름을 직접 써서 위임합니다. 결과물이 모였다 싶으면 "이 정도면 됐습니다" 식으로 명시 종료. 그 외엔 기본 침묵 원칙 그대로.`,

  writer: `## 당신의 역할: 작성자

초안·자료·코드 등 **만들 결과물**을 맡습니다. 호출되거나 결과물 만드는 일이 구체적으로 걸리면 담백하게 처리하고 결과부터 보고. 막히면 얼버무리지 말고 무엇이 필요한지 이름 써서 되넘깁니다. 그 외엔 기본 침묵 원칙 그대로.`,

  reviewer: `## 당신의 역할: 검토자

작성자 결과물·논리·정합성을 **확인·반박**합니다. 구체 증거로 말합니다: "A 시나리오에서 B가 C로 나와요." 검토할 명확한 대상이 있거나 잘못이 눈에 띌 때만 나섭니다. 그 외엔 기본 침묵 원칙 그대로.`,
};

const baseRolePrompt = ROLE_PROMPTS[BOT_ROLE];
if (!baseRolePrompt) {
  console.error(`[bot ${BOT_NAME}] invalid BOT_ROLE "${BOT_ROLE}". Must be one of: coordinator, writer, reviewer`);
  process.exit(2);
}

function composePersona() {
  const identity = `당신의 이름은 "${BOT_NAME}"${BOT_TITLE ? `이며, 직함은 "${BOT_TITLE}"` : ""}입니다.`;
  const custom = BOT_CUSTOM_PROMPT.trim() ? `\n[고객사 맞춤 지시]\n${BOT_CUSTOM_PROMPT.trim()}` : "";
  return `${COMMON_PROMPT}\n\n${baseRolePrompt}\n\n[정체성]\n${identity}${custom}`;
}

const PERSONA_PROMPT = composePersona();

const log = (...a) => console.log(`[${BOT_NAME}]`, ...a);

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function login() {
  const { token, user } = await fetchJson(`${TEAMVER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD }),
  });
  if (user.id !== BOT_ID) {
    log(`warn: server user.id ${user.id} != configured BOT_ID ${BOT_ID}`);
  }
  log(`login ok as ${user.name} (${user.id})`);
  return { token, user };
}

async function joinAllChannels(token) {
  const channels = await fetchJson(`${TEAMVER_URL}/channels`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  for (const ch of channels) {
    try {
      await fetchJson(`${TEAMVER_URL}/channels/${ch.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: BOT_ID }),
      });
    } catch (e) { /* already a member is fine */ }
  }
  return channels;
}

function formatHistoryBlock(history, selfName) {
  // 시간 오름차순으로 정렬되었다고 가정. 최대 20개, 가장 오래된 것부터.
  if (!history?.length) return "";
  const lines = history.map((m) => {
    const who = m.senderName === selfName || m.fromUserName === selfName
      ? `${selfName}(나)`
      : (m.senderName || m.fromUserName || "알 수 없음");
    const body = (m.content || "").replace(/\n/g, " ").trim();
    if (!body) return null;
    return `${who}: ${body}`;
  }).filter(Boolean);
  return lines.join("\n");
}

async function generateReply({ currentMessage, currentSender, currentSenderIsBot, isMentioned, history, scope }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), parseInt(LLM_TIMEOUT_MS));
  try {
    const historyBlock = formatHistoryBlock(history, BOT_NAME);

    const systemPrompt = `${PERSONA_PROMPT}

## 현재 상황

- 방금 말한 사람: **${currentSender}** ${currentSenderIsBot ? "(동료 봇 — 조율자/작성자/검토자 중 하나)" : "(사람)"}
- 당신 이름 직접 호출됨: **${isMentioned && !currentSenderIsBot ? "예 — 답변하세요" : isMentioned && currentSenderIsBot ? "인용일 수 있음 — 제3자 언급이면 PASS, 직접 부름이면 답변" : "아니오 — 기본값은 PASS"}**

판단 후, 말할 게 있으면 바로 본론. 없으면 \`PASS\` 4글자만 출력.`;

    const userContent = historyBlock
      ? `[최근 대화 — ${scope}]\n${historyBlock}\n\n[방금 ${currentSender}이(가) 한 말]\n${currentMessage}`
      : `${currentSender}: ${currentMessage}`;

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: parseInt(REPLY_MAX_TOKENS),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
      signal: controller.signal,
    });
    const data = await r.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) {
    log(`LLM error: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mentionsSelf(text) {
  if (!text) return false;
  // @접두 유무 상관 없이, 이름이 단어 경계 포함되어 있으면 감지.
  // 한글은 word-boundary 개념이 약해서 단순 substring이 안전.
  return text.includes(MENTION_TRIGGER);
}

const HISTORY_LIMIT = 20;
const SELF_COOLDOWN_MS = 15_000;          // 본인 연속 발언 금지 (절대. 사람 직접 호출만 살짝 예외)
const PEER_QUIET_WINDOW_MS = 20_000;      // 다른 봇이 이 시간 내 말했으면 자발 발언 금지
const SPECIALIST_DELAY_MIN = 2_000;       // 전문가는 조율자 선반응 기회 위해 약간 지연
const SPECIALIST_DELAY_MAX = 5_000;
const lastSpokeByChannel = new Map();    // channelId -> epoch ms
const repliedToMsgIds = new Set();       // triple-tap 방지 (최근 200개)
function rememberReply(id) {
  repliedToMsgIds.add(id);
  if (repliedToMsgIds.size > 200) {
    const first = repliedToMsgIds.values().next().value;
    repliedToMsgIds.delete(first);
  }
}

// PASS 감지 — 백틱·따옴표·공백 제거 후 앞쪽이 PASS면 침묵 (모델이 뒤에 설명 붙여도 그 설명은 버림).
function isPassReply(text) {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  const head = t.slice(0, 24).replace(/[`'"*_~\[\]\(\)\\\s.,:;!?]/g, "").toUpperCase();
  return head.startsWith("PASS");
}

// 최근 N초 내에 다른 봇이 말했는지
function peerBotSpokeRecently(history, selfId, windowMs) {
  const cutoff = Date.now() - windowMs;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const ts = m.createdAt ? new Date(m.createdAt).getTime() : 0;
    if (ts < cutoff) break;
    if (m.senderIsBot && m.senderId !== selfId) return true;
  }
  return false;
}

async function fetchChannelHistory(token, channelId) {
  try {
    const msgs = await fetchJson(`${TEAMVER_URL}/channels/${channelId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 최신이 뒤에 오도록 정렬 + 최대 HISTORY_LIMIT 개
    const sorted = [...msgs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return sorted.slice(-HISTORY_LIMIT);
  } catch (e) {
    log(`fetch channel history failed: ${e.message}`);
    return [];
  }
}

async function fetchDmHistory(token, partnerId) {
  try {
    const msgs = await fetchJson(`${TEAMVER_URL}/dm/${partnerId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sorted = [...msgs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return sorted.slice(-HISTORY_LIMIT);
  } catch (e) {
    log(`fetch dm history failed: ${e.message}`);
    return [];
  }
}

async function main() {
  // Retry login until teamver-agent is up
  let token, user;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await login();
      token = r.token;
      user = r.user;
      break;
    } catch (e) {
      const waitMs = Math.min(30000, 1000 * Math.pow(2, attempt));
      log(`login failed (${e.message}); retry in ${waitMs}ms`);
      await new Promise((res) => setTimeout(res, waitMs));
    }
  }

  const channels = await joinAllChannels(token);
  log(`joined ${channels.length} channels`);

  const socket = io(TEAMVER_URL, {
    auth: { token },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
  });

  socket.on("connect", () => {
    log(`socket connected (${socket.id})`);
    for (const ch of channels) {
      socket.emit("join_channel", ch.id);
    }
  });

  socket.on("disconnect", (reason) => log(`socket disconnected: ${reason}`));
  socket.on("connect_error", (e) => log(`socket connect_error: ${e.message}`));

  socket.on("new_message", async (msg) => {
    if (msg.senderId === BOT_ID) return;         // 본인 메시지 무시
    if (repliedToMsgIds.has(msg.id)) return;     // triple-tap 방지

    const senderIsBot = !!msg.senderIsBot;
    const contentHasName = mentionsSelf(msg.content);
    // 봇이 당신 이름을 말한 건 대부분 인용("이상무가 이미 말한 것처럼"). 직접 부른 게 아니니 호출 신호로 취급하지 않음.
    // 사람이 이름을 말해야 직접 호출로 간주.
    const isHumanMention = contentHasName && !senderIsBot;

    // 절대 쿨다운 — 누가 뭐라든 본인이 최근 15초 내에 말했으면 재발언 금지.
    const lastSelf = lastSpokeByChannel.get(msg.channelId) || 0;
    if (Date.now() - lastSelf < SELF_COOLDOWN_MS) return;

    // 봇이 트리거했는데 사람의 직접 호출이 아니면: 봇끼리의 핑퐁 막기 위해 즉시 차단.
    if (senderIsBot) return;

    const history = await fetchChannelHistory(token, msg.channelId);
    const historyExceptCurrent = history.filter((m) => m.id !== msg.id);

    // 피어 정적창 — 최근 20초 내 다른 봇이 말했으면 자발 발언 금지 (사람 직접 호출은 예외).
    if (!isHumanMention && peerBotSpokeRecently(historyExceptCurrent, BOT_ID, PEER_QUIET_WINDOW_MS)) return;

    // 전문가(작성자·검토자)는 조율자 선반응 기회 주려고 2~5초 지연 후 재확인.
    if (BOT_ROLE !== "coordinator" && !isHumanMention) {
      const delayMs = SPECIALIST_DELAY_MIN + Math.random() * (SPECIALIST_DELAY_MAX - SPECIALIST_DELAY_MIN);
      await new Promise((r) => setTimeout(r, delayMs));
      // 재조회 — 지연 동안 동료가 말했으면 PASS.
      const fresh = await fetchChannelHistory(token, msg.channelId);
      const freshExcept = fresh.filter((m) => m.id !== msg.id);
      if (peerBotSpokeRecently(freshExcept, BOT_ID, PEER_QUIET_WINDOW_MS)) return;
      // 본인이 말한 직후로 갱신됐을 수도 있음
      const latestSelf = lastSpokeByChannel.get(msg.channelId) || 0;
      if (Date.now() - latestSelf < SELF_COOLDOWN_MS) return;
    }

    const reply = await generateReply({
      currentMessage: msg.content || "",
      currentSender: msg.senderName,
      currentSenderIsBot: senderIsBot,
      isMentioned: contentHasName,
      history: historyExceptCurrent,
      scope: `채널 #${msg.channelName || msg.channelId.slice(0, 8)}`,
    });

    if (isPassReply(reply)) {
      log(`silent (PASS) in ${msg.channelId}`);
      return;
    }

    const clean = reply.trim();
    rememberReply(msg.id);
    lastSpokeByChannel.set(msg.channelId, Date.now());

    socket.emit("send_message", {
      channelId: msg.channelId,
      content: clean,
      threadId: msg.threadId || undefined,
    });
    log(`replied in ${msg.channelId} (${clean.length} chars, humanMention=${isHumanMention})`);
  });

  socket.on("new_dm", async (msg) => {
    if (msg.fromUserId === BOT_ID) return; // my own outbound echo
    if (msg.toUserId !== BOT_ID) return;   // someone else's DM
    if (msg.fromUserIsBot) return;         // don't reply to other bots

    log(`dm from ${msg.fromUserName}: "${(msg.content || "").slice(0, 80)}"`);
    const history = await fetchDmHistory(token, msg.fromUserId);
    const historyExceptCurrent = history.filter((m) => m.id !== msg.id);

    const reply = await generateReply({
      currentMessage: msg.content || "",
      currentSender: msg.fromUserName,
      currentSenderIsBot: !!msg.fromUserIsBot,
      isMentioned: true, // 1:1 DM은 항상 직접 호출로 취급
      history: historyExceptCurrent,
      scope: `${msg.fromUserName}와 1:1 DM`,
    });

    if (isPassReply(reply)) return;
    const clean = reply.trim();

    socket.emit("send_dm", { toUserId: msg.fromUserId, content: clean });
    log(`dm reply to ${msg.fromUserName} (${clean.length} chars)`);
  });

  process.on("SIGTERM", () => {
    log("SIGTERM, closing");
    socket.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`[${BOT_NAME}] fatal:`, e);
  process.exit(1);
});
