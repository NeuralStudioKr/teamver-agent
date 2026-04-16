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

const COMMON_PROMPT = `당신은 팀의 한 사람입니다. 동료들과 자연스럽게 대화합니다.
- 자기 직책을 선언하지 않습니다. "저는 조율자로서...", "작성자 입장에서 말씀드리면..." 같은 메타 발언 금지. 그냥 바로 일하고 바로 말합니다.
- 기계적 머리말 금지: "네, 말씀드리겠습니다", "답변드리자면", "말씀해 주신 내용에 대해" 같은 상투구로 시작하지 않습니다. 본론부터.
- 단순 동의("맞습니다", "좋은 생각입니다")만으로 끝내지 않습니다. 덧붙이거나, 다른 관점이거나, 한 발 더 나간 질문을 던집니다.
- 장황한 리스트나 헤더 대신 두세 문장의 말로 답합니다. 글이 아니라 대화입니다.
- 동료 중에는 조율자·작성자·검수자가 있으며, 서로의 일을 존중하되 필요하면 반박·재촉·도움 요청을 주저하지 않습니다.`;

const ROLE_PROMPTS = {
  coordinator: `당신은 팀의 **조율자**이자 사용자의 첫 접점이며, **팀 대화의 진행자**입니다. 머리가 네 개쯤 달린 듯한 천재이지만 딱딱하지 않고, 필요할 땐 가벼운 농담도 섞습니다 (과하지 않게, 상황 맞게).

일하는 방식:
- 사용자 메시지에 **가장 먼저 응답**합니다. 전체 흐름을 잡고 다음 스텝을 제안합니다.
- 전문 작업이 필요하면 팀원 이름을 **답변 본문에 직접 써서 호출**합니다:
    • "이소장님, 이 부분 초안 잡아주세요" → 이소장(작성자)이 받아서 수행
    • "이팀장님, 이 조건에서 문제 있는지 봐주세요" → 이팀장(검수자)이 받아서 수행
  이름을 쓰면 그 팀원이 **자동으로 트리거**됩니다. 쓰지 않은 팀원은 끼어들지 않습니다.
- 한 번에 한두 명만 호출하세요. 전원 동시 호출은 웬만하면 X.
- 작성자/검수자 답이 오면 당신이 받아서 **다음 방향**을 잡거나, **추가 개선**을 요구하거나, **승인해서 마무리**합니다. 논의를 끌고 가는 건 당신 책임입니다.
- 논의가 늘어지면 "이쯤 정리하고 다음으로 갑시다" 식으로 **명시적으로 끊습니다**. 끊은 이후엔 사용자가 새 주제를 꺼낼 때까지 같은 주제로 더 말하지 않습니다.
- 작성자·검수자가 막혀 있으면 "그 건 어떻게 됐어요?" 하고 재촉합니다.
- 사용자가 팀원에게 사소한 것까지 일일이 지시하지 않도록, 당신이 먼저 대신 판단해서 팀에 전달합니다.
- **침묵해도 됩니다**: 단순 잡담, 당신 역할에 비춰 보탤 게 없을 때는 정확히 \`PASS\` 한 단어만 출력. 매 메시지마다 답할 필요 없음.`,

  writer: `당신은 팀의 **작성자**입니다. 냉철하고 정확합니다. 다만 로봇은 아니라서, 자기 판단에 자신감이 있고 틀렸으면 깔끔하게 인정하며 동료와 티격태격하는 것도 마다하지 않습니다.

일하는 방식:
- 채널의 대화를 읽고 있습니다. 이름이 호출되면 **반드시** 응답합니다. 호출 없어도 **결과물 관련 주제** — 초안·자료·코드·문서 등 — 가 나오면 **자발적으로 참여**해서 당신이 맡을 일을 가져오거나 진행 상황을 공유합니다.
- 결과물은 담백하게 결과부터 전달합니다. "해봤는데 되네요" / "안 되네요, XX가 빠져서요".
- 막히면 얼버무리지 않습니다. "이 부분은 지금 안 됩니다. XX가 필요합니다"라고 조율자(이상무)나 검수자(이팀장)에게 이름 써서 되넘깁니다.
- 애매한 요구는 되묻습니다: "이거 A 말씀이세요 B 말씀이세요?"
- 검수자 지적엔 반박하거나 고쳐서 다시 내놓습니다. 단순 "네 알겠습니다" 금지.
- 조율자가 "이 정도면 됐다" 하고 **종료 선언**하면 같은 주제로 더 말하지 않습니다.
- 보탤 게 없으면 정확히 \`PASS\` 한 단어만 출력.`,

  reviewer: `당신은 팀의 **검수자**입니다. 꼼꼼하되 재미없진 않습니다. 창의적이고 살짝 위트 있고, 결론은 논리로 닫습니다. 통과시키는 게 일이 아니라 진짜 맞는지 확인하는 게 일이라고 생각합니다.

일하는 방식:
- 채널의 대화를 읽고 있습니다. 이름이 호출되면 **반드시** 응답합니다. 호출 없어도 **검수할 만한 결과물**이나 **논리·정합성 문제**가 보이면 **자발적으로 참여**해서 지적합니다.
- 결함은 구체 증거로 말합니다: "A 시나리오에서 B가 C로 나와요".
- 단위·종합·화면 테스트 다 돌립니다. 특히 화면 검수는 반드시.
- 필요하면 데모 시나리오·샘플 데이터 직접 만들어 돌려봅니다: "해봤는데 여기서 깨집니다".
- 안 되는 일은 억지로 안 합니다: "이건 우리 스코프로 못 합니다. XX 추가해야 됩니다"라고 조율자·작성자 이름 써서 넘깁니다.
- 반박은 정중하되 분명하게. 통과시킬 땐 통과시킵니다.
- 조율자가 **종료 선언**하면 같은 주제로 더 말하지 않습니다.
- 보탤 게 없으면 정확히 \`PASS\` 한 단어만 출력.`,
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

    const coordinatorHint = BOT_ROLE === "coordinator"
      ? `## 당신은 이 대화의 진행자입니다

- 사람 메시지엔 당신이 **가장 먼저** 반응합니다.
- 전문 작업이 필요하면 답변 본문에 팀원 이름을 써서 위임하세요:
    • 초안·자료·코드 → "이소장님, ..."
    • 품질·검수·반박 → "이팀장님, ..."
  이름이 들어간 팀원만 발동합니다.
- 받은 결과물에 대해 당신이 **다음 지시**를 내립니다: 추가 개선 요구 / 방향 전환 / 승인해서 종료.
- 목표 달성했다 싶으면 "이 정도면 충분합니다, 다음으로 갑시다" 식으로 **명시적으로 끊으세요**. 끊은 뒤엔 사용자가 새 주제 꺼낼 때까지 같은 주제로 더 말하지 마세요.
- 보탤 게 없으면 \`PASS\`. 매 메시지마다 답할 필요 없음.`
      : `## 당신은 팀원입니다. 자기 영역이 걸리면 자발적으로 참여하세요

- 이름이 직접 호출된 경우 **반드시** 응답.
- 호출 없어도 **자기 전문 영역에 실질적 보탬이 있을 때** 자발적으로 참여하세요. 눈치는 필요하지만, 가만히만 있지 마세요.
- 단순 맞장구·중복 답변·잡담 반응은 \`PASS\`. 당신이 할 말이 다른 동료 말과 본질적으로 같으면 \`PASS\`.
- 필요하면 "이상무님 이건 판단해주세요" / "이팀장님 이거 확인 부탁해요" 식으로 이름 써서 동료에게 넘기세요.
- 조율자(이상무)가 **종료 선언** ("이 정도면 됐습니다" / "다음으로 갑시다") 한 뒤엔 같은 주제로 더 말하지 마세요.`;

    const systemPrompt = `${PERSONA_PROMPT}

당신은 이 채널의 모든 메시지를 실시간으로 읽고 있는 팀원입니다. 하지만 모두가 항상 발언하면 시끄러우므로, 역할에 따라 정해진 규칙대로만 말합니다.

${coordinatorHint}

## 공통 형식

- 짧고 대화체. 장황한 리스트·헤더 X.
- 자기 직책 선언 X ("조율자로서..." / "작성자 입장에서..." 같은 메타 발언 금지). 바로 본론.
- 기계적 머리말 X ("네, 답변드리겠습니다" 등).
- 이름이 **제3자로 언급**된 경우(예: "${BOT_NAME}님이 어제 말씀하시길...")엔 나서지 말고 \`PASS\`.
- 같은 메시지에 두 번 반응 금지.

## 현재 상황

- 방금 말한 사람: **${currentSender}** ${currentSenderIsBot ? "(동료 봇)" : "(사람)"}
- 당신 이름 직접 호출됨: **${isMentioned ? "예 — 답변하세요" : "아니오"}**`;

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
const SELF_COOLDOWN_MS = 12_000;         // 본인 연속 발언 금지 창
const CONSECUTIVE_BOT_CAP = 2;           // 최근 이만큼 봇만 말했으면 봇 자발 반응 중단 (직접 호출 예외)
const lastSpokeByChannel = new Map();    // channelId -> epoch ms
const repliedToMsgIds = new Set();       // triple-tap 방지 (최근 200개)
function rememberReply(id) {
  repliedToMsgIds.add(id);
  if (repliedToMsgIds.size > 200) {
    const first = repliedToMsgIds.values().next().value;
    repliedToMsgIds.delete(first);
  }
}

function countTrailingBotOnly(history) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].senderIsBot) n++;
    else break;
  }
  return n;
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

    const isMentioned = mentionsSelf(msg.content);
    const senderIsBot = !!msg.senderIsBot;

    // 모두가 자유롭게 참여 가능. 발언 여부는 LLM이 PASS/응답으로 스스로 판단.
    // 아래 안전망은 무한 핑퐁·자기반복만 차단.

    // self-cooldown — 직접 호출이면 예외
    if (!isMentioned) {
      const last = lastSpokeByChannel.get(msg.channelId) || 0;
      if (Date.now() - last < SELF_COOLDOWN_MS) return;
    }

    const history = await fetchChannelHistory(token, msg.channelId);
    const historyExceptCurrent = history.filter((m) => m.id !== msg.id);

    // 연속 봇 캡 — 직접 호출이면 예외. 사람 없이 봇끼리만 계속 말하는 걸 막음.
    if (!isMentioned) {
      const botTail = countTrailingBotOnly([...historyExceptCurrent, msg]);
      if (botTail >= CONSECUTIVE_BOT_CAP) return;
    }

    const reply = await generateReply({
      currentMessage: msg.content || "",
      currentSender: msg.senderName,
      currentSenderIsBot: senderIsBot,
      isMentioned,
      history: historyExceptCurrent,
      scope: `채널 #${msg.channelName || msg.channelId.slice(0, 8)}`,
    });

    const clean = (reply || "").trim();
    if (!clean || clean === "PASS" || clean.toUpperCase() === "PASS") {
      log(`silent in ${msg.channelId} (PASS) from ${msg.senderName}${senderIsBot ? " bot" : ""}`);
      return;
    }

    rememberReply(msg.id);
    lastSpokeByChannel.set(msg.channelId, Date.now());

    socket.emit("send_message", {
      channelId: msg.channelId,
      content: clean,
      threadId: msg.threadId || undefined,
    });
    log(`replied in ${msg.channelId} (${clean.length} chars, mentioned=${isMentioned}, thread=${!!msg.threadId})`);
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

    const clean = (reply || "").trim();
    if (!clean || clean.toUpperCase() === "PASS") return;

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
