import type { FastifyInstance } from 'fastify'
import { store } from '../services/store.js'
import { generateAIResponse, shouldAIRespond } from '../services/ai-agent.js'

export async function channelRoutes(app: FastifyInstance) {
  app.get('/channels', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId } = (req as any).user
    return store.getChannels(workspaceId)
  })

  app.post('/channels', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId, id: creatorId } = (req as any).user
    const { name, description } = req.body as any
    if (!name) return reply.status(400).send({ error: '채널 이름 필요' })
    const channel = await store.createChannel(workspaceId, name, description)
    // 창작자 + 워크스페이스 모든 봇 자동 membership
    await store.addChannelMember(channel.id, creatorId)
    const members = await store.getMembers(workspaceId)
    for (const m of members) {
      if (m.isBot) await store.addChannelMember(channel.id, m.id)
    }
    const io = (app as any).io
    if (io) io.to(`ws:${workspaceId}`).emit('channel_created', channel)
    return channel
  })

  app.patch('/channels/:channelId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = (req as any).user
    const { channelId } = req.params as any
    const { name } = req.body as any
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) return reply.status(400).send({ error: '채널 이름 필요' })
    const channel = await store.renameChannel(channelId, workspaceId, trimmed)
    if (!channel) return reply.status(404).send({ error: '채널을 찾을 수 없습니다' })
    const io = (app as any).io
    if (io) io.to(`ws:${workspaceId}`).emit('channel_updated', channel)
    return channel
  })

  app.delete('/channels/:channelId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = (req as any).user
    const { channelId } = req.params as any
    const ok = await store.deleteChannel(channelId, workspaceId)
    if (!ok) return reply.status(404).send({ error: '채널을 찾을 수 없습니다' })
    const io = (app as any).io
    if (io) io.to(`ws:${workspaceId}`).emit('channel_deleted', { channelId })
    return { ok: true }
  })

  app.get('/channels/:channelId/messages', { onRequest: [app.authenticate] }, async (req) => {
    const { channelId } = req.params as any
    return store.getMessages(channelId)
  })

  // HTTP로 채널 메시지 전송 — OpenClaw 등 외부 클라이언트가 Socket.IO 없이 메시지 POST 가능
  app.post('/channels/:channelId/messages', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { channelId } = req.params as any
    const { content, threadId, fileUrl, fileName, fileType } = req.body as any
    const { id: senderId, name: senderName, isBot: senderIsBot } = (req as any).user
    if (!content?.trim() && !fileUrl) return reply.status(400).send({ error: '내용 필요' })
    const message = await store.addMessage({
      channelId, threadId: threadId || null,
      senderId, senderName, senderIsBot,
      content: content?.trim() || null, fileUrl: fileUrl || null, fileName: fileName || null, fileType: fileType || null,
    })
    // 소켓으로 실시간 브로드캐스트
    const io = (app as any).io
    if (io) {
      if (threadId) {
        io.to(channelId).emit('thread_reply', { threadId, message })
      } else {
        io.to(channelId).emit('new_message', message)
      }
    }
    // AI 자동 응답 (봇이름 언급 시) — 외부 openclaw-bot 컨테이너 사용 시 스킵
    if (!senderIsBot && process.env.EXTERNAL_BOTS_ENABLED !== 'true') {
      const agents = [
        { id: '00000000-0000-0000-0000-000000000001', name: '이대표' },
        { id: '00000000-0000-0000-0000-000000000002', name: '한이사' },
        { id: '00000000-0000-0000-0000-000000000003', name: '이본부장' },
      ]
      for (const agent of agents) {
        if (shouldAIRespond(agent.id, content || '', false)) {
          const aiText = await generateAIResponse(agent.id, '', content || '', senderName)
          if (aiText) {
            const aiMsg = await store.addMessage({
              channelId,
              senderId: agent.id,
              senderName: agent.name,
              senderIsBot: true,
              content: aiText,
            })
            if (io) io.to(channelId).emit('new_message', aiMsg)
          }
        }
      }
    }
    return message
  })

  app.get('/members', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId } = (req as any).user
    const members = await store.getMembers(workspaceId)
    return members.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, isBot: u.isBot, avatarUrl: u.avatarUrl }))
  })

  // 채널 멤버 목록
  app.get('/channels/:channelId/members', { onRequest: [app.authenticate] }, async (req) => {
    const { channelId } = req.params as any
    const { workspaceId } = (req as any).user
    return store.getChannelMembers(channelId, workspaceId)
  })

  // 채널 멤버 초대
  app.post('/channels/:channelId/members', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { channelId } = req.params as any
    const { userId } = req.body as any
    if (!userId) return reply.status(400).send({ error: 'userId 필요' })
    await store.addChannelMember(channelId, userId)
    return { ok: true }
  })

  // Thread
  app.get('/messages/:messageId/replies', { onRequest: [app.authenticate] }, async (req) => {
    const { messageId } = req.params as any
    return store.getThreadMessages(messageId)
  })

  // Reactions
  app.post('/messages/:messageId/reactions', { onRequest: [app.authenticate] }, async (req) => {
    const { messageId } = req.params as any
    const { emoji } = req.body as any
    const { id: userId } = (req as any).user
    return store.addReaction(messageId, emoji, userId)
  })
}
