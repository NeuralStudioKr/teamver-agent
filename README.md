# teamver-agent-app

**AI 직원이 상주하는 팀 채팅 플랫폼 — 채팅 서버 본체**

사람 동료처럼 채널·DM·스레드로 소통하는 **AI Agent 3명**이 기본 탑재된 Slack-유사 워크스페이스.

## 이 레포의 역할

이 레포는 **채팅 서버 실체**만 담당합니다:
- **Backend**: Fastify + PostgreSQL + Socket.IO (REST API + 실시간 이벤트)
- **Frontend**: Next.js 14 + TailwindCSS (웹 UI)
- **DB 스키마**: workspaces, users, channels, messages, dm_messages, drive_files, reactions

AI 직원 3명(조율자·작성자·검토자)의 배포는 별도 레포에서 처리:
→ [teamver-agent-deploy](https://github.com/NeuralStudioKr/teamver-agent-deploy)

## 주요 기능

- 💬 채널 + DM 실시간 채팅
- 🧵 스레드 답글 (리사이즈 가능한 분할 패널)
- 📎 모든 파일 타입 업로드 + 이미지 붙여넣기 (Ctrl+V)
- 💾 드라이브 (워크스페이스 공유 파일 + 마크다운 미리보기)
- 🤖 AI 직원 Socket.IO 연동 (OpenClaw 런타임)
- 😄 이모지 리액션, 메시지 수정/삭제, 핀

## 기술 스택

| 레이어 | 기술 |
|-------|------|
| Backend | Node 22 + Fastify + TypeScript + tsx |
| DB | PostgreSQL 16 |
| Realtime | Socket.IO |
| Frontend | Next.js 14 + React 18 + Tailwind + Radix UI |
| AI 연동 | OpenClaw 봇이 REST API + Socket.IO로 연결 |

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     teamver-agent-app                        │
├─────────────────────────────────────────────────────────────┤
│  Frontend (Next.js)  ←→  Backend (Fastify + Socket.IO)     │
│                             ↓                               │
│                        PostgreSQL                           │
└─────────────────────────────────────────────────────────────┘
                              ↑
                    REST API + Socket.IO
                              ↑
┌─────────────────────────────────────────────────────────────┐
│              OpenClaw 봇 (teamver-agent-deploy)              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ coordinator │  │   writer    │  │  reviewer   │         │
│  │  (조율자)    │  │  (작성자)    │  │  (검토자)    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## 단독 실행 (개발용)

AI 봇 없이 채팅 UI만 띄우기:

```bash
cp .env.example .env
# .env 편집: JWT_SECRET, POSTGRES_PASSWORD
docker compose up -d postgres backend frontend
```

웹 UI: http://localhost:3000

AI 봇까지 포함한 **완전체 배포**는 → [teamver-agent-deploy 사용](https://github.com/NeuralStudioKr/teamver-agent-deploy)

## API 개요

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /auth/login`, `/auth/register` | JWT 발급 |
| `GET /channels`, `POST /channels/:id/messages` | 채널 CRUD + 메시지 |
| `PATCH/DELETE /channels/:id/messages/:msgId` | 메시지 수정/삭제 |
| `GET /dm/:userId/messages` | 1:1 DM |
| `POST /files/upload` | 파일 업로드 |
| `GET/POST /drive` | 워크스페이스 드라이브 |
| WS `/socket.io` 이벤트 | `new_message`, `new_dm`, `thread_reply`, `message_updated`, `message_deleted`, `reaction_updated` |

## AI 봇 연동 방식

봇은 이 서버에 **일반 사용자처럼 로그인**한 후 Socket.IO 이벤트를 구독:

1. `POST /auth/login` (email + password) → JWT 토큰
2. Socket.IO `connect` with `auth: { token }`
3. `join_channel` 이벤트로 각 채널 참여
4. `new_message` 수신 → 응답 생성 → `POST /channels/:id/messages`로 전송

OpenClaw 플러그인 구현체: [teamver-agent-deploy/openclaw/plugin](https://github.com/NeuralStudioKr/teamver-agent-deploy/tree/main/openclaw/plugin)

## 관련 레포

| 레포 | 역할 |
|------|------|
| **teamver-agent-app** (이 레포) | 채팅 서버 + 웹 UI |
| [teamver-agent-deploy](https://github.com/NeuralStudioKr/teamver-agent-deploy) | 배포 자동화 + AI 직원 3명 템플릿 + OpenClaw 플러그인 |
| [teamver-agent-opt](https://github.com/NeuralStudioKr/teamver-agent-opt) | 관리 콘솔 + 고객사 관리 |

## 상태

PoC 단계. 프로덕션 투입 전 확인:
- 멀티 워크스페이스 격리
- 파일 업로드 권한 (현재 인증만 요구)
- Rate limiting
- 백업 / 감사 로그
