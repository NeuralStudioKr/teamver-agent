import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { Server } from 'socket.io'
import { authRoutes } from './routes/auth.js'
import { channelRoutes } from './routes/channels.js'
import { dmRoutes } from './routes/dm.js'
import { workspaceRoutes } from './routes/workspace.js'
import { fileRoutes } from './routes/files.js'
import { driveRoutes } from './routes/drive.js'
import { notifyNewMessage, notifyNewDm } from './services/webhook.js'
import { store } from './services/store.js'
import { initDB } from './services/db.js'
// AI 자동 응답 비활성화 — OpenClaw 인스턴스가 직접 로그인해서 메시지 전송
import { generateAIResponse, shouldAIRespond } from './services/ai-agent.js'
import path from 'path'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET required')
const PORT = parseInt(process.env.PORT || '3001')

const app = Fastify({ logger: { level: 'info' } })

await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], credentials: true })
await app.register(jwt, { secret: JWT_SECRET })
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
await app.register(staticFiles, { root: '/tmp/uploads', prefix: '/uploads/' })

app.decorate('authenticate', async (request: any, reply: any) => {
  try { await request.jwtVerify() }
  catch { reply.status(401).send({ error: '인증 필요' }) }
})
app.decorate('io', null)

await initDB()
await app.register(authRoutes)
await app.register(channelRoutes)
await app.register(dmRoutes)
await app.register(workspaceRoutes)
await app.register(fileRoutes)
await app.register(driveRoutes)
app.get('/health', async () => ({ status: 'ok', version: '2.0.0' }))

const io = new Server(app.server, { cors: { origin: true, credentials: true } })
;(app as any).io = io

io.use((socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) return next(new Error('Auth required'))
  try {
    const payload = app.jwt.verify(token) as any
    socket.data.user = payload
    next()
  } catch { next(new Error('Invalid token')) }
})

io.on('connection', (socket) => {
  const user = socket.data.user

  socket.join(`ws:${user.workspaceId}`)
  socket.join(`dm:${user.id}`)

  socket.on('join_channel', (channelId: string) => socket.join(channelId))

  socket.on('send_message', async ({ channelId, content, threadId, fileUrl, fileName, fileType }: any) => {
    if (!channelId) return
    const message = await store.addMessage({
      channelId, threadId, senderId: user.id, senderName: user.name,
      senderIsBot: user.isBot, content, fileUrl, fileName, fileType,
    })
    if (threadId) {
      io.to(channelId).emit('thread_reply', { threadId, message })
    } else {
      io.to(channelId).emit('new_message', message)
    }

    // OpenClaw 웹훅 알림 (봇 제외 메시지만)
    if (!user.isBot) {
      const channels = await store.getChannels(user.workspaceId)
      const ch = channels.find((c: any) => c.id === channelId)
      notifyNewMessage({
        channelId,
        channelName: ch?.name || channelId,
        senderId: user.id,
        senderName: user.name,
        senderIsBot: user.isBot,
        content: content || '',
        messageId: message.id,
      })
    }
    // AI 자동 응답 (봇이름 언급 시) — 외부 openclaw-bot 컨테이너 사용 시 스킵
    if (!user.isBot && process.env.EXTERNAL_BOTS_ENABLED !== 'true') {
      const agents = [
        { id: '00000000-0000-0000-0000-000000000001', name: '이대표' },
        { id: '00000000-0000-0000-0000-000000000002', name: '한이사' },
        { id: '00000000-0000-0000-0000-000000000003', name: '이본부장' },
      ]
      for (const agent of agents) {
        if (shouldAIRespond(agent.id, content || '', false)) {
          const aiText = await generateAIResponse(agent.id, '', content || '', user.name)
          if (aiText) {
            const aiMsg = await store.addMessage({
              channelId,
              senderId: agent.id,
              senderName: agent.name,
              senderIsBot: true,
              content: aiText,
            })
            io.to(channelId).emit('new_message', aiMsg)
          }
        }
      }
    }
  })

  socket.on('send_dm', async ({ toUserId, content, fileUrl, fileName }: any) => {
    if (!toUserId || !content?.trim()) return
    const message = await store.createDmMessage(user.workspaceId, user.id, toUserId, content.trim(), fileUrl, fileName)
    io.to(`dm:${toUserId}`).emit('new_dm', message)
    socket.emit('new_dm', message)

    // OpenClaw 웹훅 알림 (DM)
    notifyNewDm({
      fromUserId: user.id,
      fromUserName: user.name,
      toUserId,
      content: content?.trim() || '',
      messageId: message.id,
    })
    // AI DM 자동 응답 — 외부 openclaw-bot 컨테이너 사용 시 스킵
    if (content?.trim() && process.env.EXTERNAL_BOTS_ENABLED !== 'true') {
      const agents = [
        { id: '00000000-0000-0000-0000-000000000001', name: '이대표' },
        { id: '00000000-0000-0000-0000-000000000002', name: '한이사' },
        { id: '00000000-0000-0000-0000-000000000003', name: '이본부장' },
      ]
      for (const agent of agents) {
        if (shouldAIRespond(agent.id, content, false)) {
          const aiText = await generateAIResponse(agent.id, '', content, user.name)
          if (aiText) {
            const aiMsg = await store.createDmMessage(user.workspaceId, agent.id, user.id, aiText)
            io.to(`dm:${user.id}`).emit('new_dm', aiMsg)
          }
        }
      }
    }
  })

  socket.on('typing', ({ channelId, isTyping }: any) => {
    socket.to(channelId).emit('user_typing', { userId: user.id, userName: user.name, isTyping })
  })

  socket.on('dm_typing', ({ toUserId, isTyping }: any) => {
    socket.to(`dm:${toUserId}`).emit('dm_user_typing', { userId: user.id, userName: user.name, isTyping })
  })

  socket.on('add_reaction', async ({ messageId, emoji }: any) => {
    const message = await store.addReaction(messageId, emoji, user.id)
    const msg = await store.getMessageById(messageId)
    if (msg) io.to(msg.channelId).emit('reaction_updated', message)
  })

  socket.on('disconnect', () => app.log.info(`Disconnected: ${user.name}`))
})

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`🚀 teamver-agent v2 running on :${PORT}`)
