import type { FastifyInstance } from 'fastify'
import { store } from '../services/store.js'

export async function dmRoutes(app: FastifyInstance) {
  app.get('/dm/conversations', { onRequest: [app.authenticate] }, async (req) => {
    const { id: userId, workspaceId } = (req as any).user
    return store.getDmConversations(workspaceId, userId)
  })

  app.get('/dm/:userId/messages', { onRequest: [app.authenticate] }, async (req) => {
    const { id: currentUserId, workspaceId } = (req as any).user
    const { userId } = req.params as any
    return store.getDmMessages(workspaceId, currentUserId, userId)
  })

  app.post('/dm/:userId/messages', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id: currentUserId, workspaceId, isBot, name } = (req as any).user
    const { userId } = req.params as any
    const { content } = req.body as any
    if (!content?.trim()) return reply.status(400).send({ error: '내용 필요' })
    const message = await store.createDmMessage(workspaceId, currentUserId, userId, content.trim())
    // 소켓으로 실시간 브로드캐스트
    const io = (app as any).io
    if (io) {
      io.to(`dm:${userId}`).emit('new_dm', message)
      io.to(`dm:${currentUserId}`).emit('new_dm', message)
    }
    return message
  })
}
