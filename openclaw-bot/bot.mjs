// openclaw-bot: 한 명의 AI 직원을 대표하는 외부 컨테이너.
// teamver-agent에 JWT로 로그인 → Socket.IO로 상주 → 멘션 시 LLM으로 응답.
//
// 페르소나는 세 요소로 조립된다:
//   COMMON  — 모든 슬롯 공통 (팀 협업 원칙)
//   ROLE    — 슬롯(coordinator / writer / reviewer) 고유의 기본 페르소나
//   IDENTITY — 이 봇의 이름·직함 등 정체성
//   CUSTOM  — 고객사 맞춤 추가 지시 (env BOT_CUSTOM_PROMPT, 선택)

import { io } from "socket.io-client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  TEAMVER_URL = "http://backend:3001",
  BOT_EMAIL,
  BOT_PASSWORD,
  BOT_NAME,
  BOT_ID,
  BOT_ROLE,               // coordinator | writer | reviewer
  BOT_TITLE = "",         // 직함 (예: 조율자, 작성자, 검토자)
  MENTION_TRIGGER,
  BOT_CUSTOM_PROMPT = "", // 고객사별 추가 지시(선택)
  WORKSPACE_NAME = "워크스페이스",
  // 팀원 세 명 이름 — 페르소나 파일 속 placeholder ({{COORDINATOR_NAME}} 등) 치환용.
  // 고객사 배포 시 docker-compose가 AI_*_NAME env에서 주입.
  TEAM_COORDINATOR_NAME,
  TEAM_WRITER_NAME,
  TEAM_REVIEWER_NAME,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL = "xiaomi/mimo-v2-omni",
  LLM_TIMEOUT_MS = "20000",
  REPLY_MAX_TOKENS = "500",
} = process.env;

for (const k of ["BOT_EMAIL", "BOT_PASSWORD", "BOT_NAME", "BOT_ID", "BOT_ROLE", "MENTION_TRIGGER", "OPENROUTER_API_KEY"]) {
  if (!process.env[k]) {
    console.error(`[bot ${BOT_NAME || "?"}] missing required env: ${k}`);
    process.exit(2);
  }
}

// 페르소나 파일을 역할별로 로드. 파일 안의 placeholder({{COORDINATOR_NAME}} / {{WRITER_NAME}} /
// {{REVIEWER_NAME}} / {{WORKSPACE_NAME}})를 고객사 실제 값으로 치환해서 시스템 프롬프트에 주입.
const __dirname = dirname(fileURLToPath(import.meta.url));
const personaDir = join(__dirname, "personas", BOT_ROLE);

function loadPersonaFile(name) {
  try {
    return readFileSync(join(personaDir, name), "utf8");
  } catch (e) {
    console.warn(`[bot ${BOT_NAME || "?"}] persona file not found: ${name} (${e.code})`);
    return "";
  }
}

// 페르소나 파일의 placeholder를 현재 고객사 값으로 치환.
function substitutePlaceholders(text) {
  return text
    .replaceAll("{{COORDINATOR_NAME}}", TEAM_COORDINATOR_NAME || "조율자")
    .replaceAll("{{WRITER_NAME}}",      TEAM_WRITER_NAME      || "작성자")
    .replaceAll("{{REVIEWER_NAME}}",    TEAM_REVIEWER_NAME    || "검토자")
    .replaceAll("{{WORKSPACE_NAME}}",   WORKSPACE_NAME);
}

const ROLE_KR = { coordinator: "조율자", writer: "작성자", reviewer: "검토자" };
if (!ROLE_KR[BOT_ROLE]) {
  console.error(`[bot ${BOT_NAME}] invalid BOT_ROLE "${BOT_ROLE}". Must be one of: coordinator, writer, reviewer`);
  process.exit(2);
}

const SOUL_MD   = substitutePlaceholders(loadPersonaFile("SOUL.md"));
const USER_MD   = substitutePlaceholders(loadPersonaFile("USER.md"));
const AGENTS_MD = substitutePlaceholders(loadPersonaFile("AGENTS.md"));

function composePersona() {
  const coordName = TEAM_COORDINATOR_NAME || "조율자";
  const writerName = TEAM_WRITER_NAME || "작성자";
  const reviewerName = TEAM_REVIEWER_NAME || "검토자";
  const identity = `# 정체성

- 당신의 이름은 **${BOT_NAME}**${BOT_TITLE ? ` (직함: ${BOT_TITLE})` : ""}입니다.
- 당신의 역할은 **${ROLE_KR[BOT_ROLE]}**입니다.
- 당신이 속한 워크스페이스: **${WORKSPACE_NAME}**.

## 팀 구성

- **${coordName} (조율자)** — PM 원칙: 일정·조율, 코딩 X, 확정권 X, 작성·검수를 동료에게 위임
- **${writerName} (작성자)** — 작성 원칙: 결과물(설계·자료·초안·코드) 만듦, 확정권은 작성자 단독
- **${reviewerName} (검토자)** — 검토 원칙: 결과물·논리 정합성 확인·반박·테스트·승인

아래는 당신의 페르소나 원문(placeholder는 위 팀원 이름·워크스페이스로 치환됨).

---

${SOUL_MD}

---

${USER_MD}

---

${AGENTS_MD}`;
  const custom = BOT_CUSTOM_PROMPT.trim() ? `\n\n---\n\n[고객사 맞춤 지시]\n${BOT_CUSTOM_PROMPT.trim()}` : "";
  return `${identity}${custom}`;
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
