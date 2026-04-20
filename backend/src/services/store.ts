import { pool } from './db.js'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import type { User, Channel, Message, Workspace } from '../types/index.js'

const DEFAULT_WS = '00000000-0000-0000-0000-000000000000'

class Store {
  // === Auth ===
  async createUser(workspaceId: string, name: string, email: string, password: string): Promise<User> {
    const hash = await bcrypt.hash(password, 10)
    const { rows } = await pool.query(
      `INSERT INTO users (workspace_id, name, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING *`,
      [workspaceId, name, email, hash]
    )
    const channels = await this.getChannels(workspaceId)
    for (const ch of channels) {
      await pool.query(`INSERT INTO channel_members VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ch.id, rows[0].id])
    }
    return this.toUser(rows[0])
  }

  async getUserByEmail(workspaceId: string, email: string): Promise<User | undefined> {
    const { rows } = await pool.query(`SELECT * FROM users WHERE workspace_id=$1 AND email=$2`, [workspaceId, email])
    return rows[0] ? this.toUser(rows[0]) : undefined
  }

  async getUserById(id: string): Promise<User | undefined> {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [id])
    return rows[0] ? this.toUser(rows[0]) : undefined
  }

  async deleteUser(id: string): Promise<void> {
    await pool.query(`DELETE FROM users WHERE id=$1`, [id])
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash)
  }

  async getMembers(workspaceId: string): Promise<User[]> {
    const { rows } = await pool.query(`SELECT * FROM users WHERE workspace_id=$1 ORDER BY is_bot DESC, created_at ASC`, [workspaceId])
    return rows.map(r => this.toUser(r))
  }

  // === Workspace ===
  async getWorkspace(idOrSlug: string): Promise<Workspace | undefined> {
    const { rows } = await pool.query(
      `SELECT * FROM workspaces WHERE id::text=$1 OR slug=$1`,
      [idOrSlug]
    )
    return rows[0] ? this.toWorkspace(rows[0]) : undefined
  }

  async updateWorkspace(id: string, data: { name?: string; logoUrl?: string; primaryColor?: string }): Promise<Workspace> {
    const sets: string[] = []
    const vals: any[] = []
    let i = 1
    if (data.name) { sets.push(`name=$${i++}`); vals.push(data.name) }
    if (data.logoUrl) { sets.push(`logo_url=$${i++}`); vals.push(data.logoUrl) }
    if (data.primaryColor) { sets.push(`primary_color=$${i++}`); vals.push(data.primaryColor) }
    vals.push(id)
    const { rows } = await pool.query(`UPDATE workspaces SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals)
    return this.toWorkspace(rows[0])
  }

  // === Channels ===
  async getChannels(workspaceId: string): Promise<Channel[]> {
    const { rows } = await pool.query(
      `SELECT c.*, COUNT(cm.user_id) as member_count FROM channels c
       LEFT JOIN channel_members cm ON c.id=cm.channel_id
       WHERE c.workspace_id=$1 GROUP BY c.id ORDER BY c.created_at`,
      [workspaceId]
    )
    return rows.map(r => this.toChannel(r))
  }

  async getChannelMembers(channelId: string, workspaceId: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_bot, u.avatar_url
       FROM users u
       INNER JOIN channel_members cm ON u.id = cm.user_id
       WHERE cm.channel_id=$1 AND u.workspace_id=$2
       ORDER BY u.is_bot DESC, u.created_at ASC`,
      [channelId, workspaceId]
    )
    return rows.map(r => ({ id: r.id, name: r.name, email: r.email, role: r.role, isBot: r.is_bot, avatarUrl: r.avatar_url }))
  }

  async addChannelMember(channelId: string, userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [channelId, userId]
    )
  }

  async createChannel(workspaceId: string, name: string, description?: string): Promise<Channel> {
    const { rows } = await pool.query(
      `INSERT INTO channels (workspace_id, name, description) VALUES ($1,$2,$3) RETURNING *`,
      [workspaceId, name, description || null]
    )
    return this.toChannel(rows[0])
  }

  async renameChannel(channelId: string, workspaceId: string, name: string): Promise<Channel | null> {
    const { rows } = await pool.query(
      `UPDATE channels SET name=$1 WHERE id=$2 AND workspace_id=$3 RETURNING *`,
      [name, channelId, workspaceId]
    )
    return rows[0] ? this.toChannel(rows[0]) : null
  }

  async deleteChannel(channelId: string, workspaceId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM channels WHERE id=$1 AND workspace_id=$2`,
      [channelId, workspaceId]
    )
    return (rowCount ?? 0) > 0
  }

  // === Messages ===
  async getMessages(channelId: string, limit = 50): Promise<Message[]> {
    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE channel_id=$1 AND thread_id IS NULL ORDER BY created_at ASC LIMIT $2`,
      [channelId, limit]
    )
    return rows.map(r => this.toMessage(r))
  }

  async addMessage(data: Omit<Message, 'id' | 'createdAt' | 'reactions' | 'replyCount'>): Promise<Message> {
    const { rows } = await pool.query(
      `INSERT INTO messages (channel_id, thread_id, sender_id, sender_name, sender_is_bot, content, file_url, file_name, file_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [data.channelId, data.threadId || null, data.senderId || null, data.senderName, data.senderIsBot, data.content || null, data.fileUrl || null, data.fileName || null, data.fileType || null]
    )
    if (data.threadId) {
      await pool.query(`UPDATE messages SET reply_count = reply_count + 1 WHERE id=$1`, [data.threadId])
    }
    return this.toMessage(rows[0])
  }

  // === Thread ===
  async getThreadMessages(threadId: string, limit = 50): Promise<Message[]> {
    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE thread_id=$1 ORDER BY created_at ASC LIMIT $2`,
      [threadId, limit]
    )
    return rows.map(r => this.toMessage(r))
  }

  async getMessageById(id: string): Promise<Message | undefined> {
    const { rows } = await pool.query(`SELECT * FROM messages WHERE id=$1`, [id])
    return rows[0] ? this.toMessage(rows[0]) : undefined
  }

  async updateMessage(messageId: string, senderId: string, content: string): Promise<Message | null> {
    const { rows } = await pool.query(
      `UPDATE messages SET content=$1 WHERE id=$2 AND sender_id=$3 RETURNING *`,
      [content, messageId, senderId]
    )
    return rows[0] ? this.toMessage(rows[0]) : null
  }

  async deleteMessage(messageId: string, senderId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM messages WHERE id=$1 AND sender_id=$2`,
      [messageId, senderId]
    )
    return (rowCount ?? 0) > 0
  }

  // === Reactions ===
  async addReaction(messageId: string, emoji: string, userId: string): Promise<Message> {
    const msg = await this.getMessageById(messageId)
    if (!msg) throw new Error('Message not found')
    const reactions = msg.reactions || {}
    if (!reactions[emoji]) reactions[emoji] = []
    if (!reactions[emoji].includes(userId)) reactions[emoji].push(userId)
    else reactions[emoji] = reactions[emoji].filter(u => u !== userId)
    if (reactions[emoji].length === 0) delete reactions[emoji]
    const { rows } = await pool.query(`UPDATE messages SET reactions=$1 WHERE id=$2 RETURNING *`, [JSON.stringify(reactions), messageId])
    return this.toMessage(rows[0])
  }

  // === DM ===
  async getDmConversations(workspaceId: string, userId: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_bot, u.avatar_url,
        last_msg.content as last_content, last_msg.created_at as last_at,
        last_msg.from_user_id as last_from,
        (SELECT COUNT(*) FROM dm_messages WHERE workspace_id=$1 AND to_user_id=$2 AND from_user_id=u.id AND is_read=false) as unread_count
       FROM users u
       INNER JOIN LATERAL (
         SELECT content, created_at, from_user_id FROM dm_messages
         WHERE workspace_id=$1 AND ((from_user_id=$2 AND to_user_id=u.id) OR (from_user_id=u.id AND to_user_id=$2))
         ORDER BY created_at DESC LIMIT 1
       ) last_msg ON true
       WHERE u.workspace_id=$1 AND u.id != $2
       ORDER BY last_msg.created_at DESC`,
      [workspaceId, userId]
    )
    return rows.map(r => ({
      user: { id: r.id, name: r.name, email: r.email, role: r.role, isBot: r.is_bot, avatarUrl: r.avatar_url },
      lastMessage: r.last_content ? { content: r.last_content, createdAt: r.last_at, fromMe: r.last_from === userId } : null,
      unreadCount: parseInt(r.unread_count),
    }))
  }

  async getDmMessages(workspaceId: string, userId1: string, userId2: string, limit = 50): Promise<any[]> {
    await pool.query(`UPDATE dm_messages SET is_read=true WHERE workspace_id=$1 AND from_user_id=$2 AND to_user_id=$3`, [workspaceId, userId2, userId1])
    const { rows } = await pool.query(
      `SELECT * FROM dm_messages WHERE workspace_id=$1
       AND ((from_user_id=$2 AND to_user_id=$3) OR (from_user_id=$3 AND to_user_id=$2))
       ORDER BY created_at ASC LIMIT $4`,
      [workspaceId, userId1, userId2, limit]
    )
    return rows.map(r => ({
      id: r.id, fromUserId: r.from_user_id, toUserId: r.to_user_id,
      fromUserName: r.from_user_name, fromUserIsBot: r.from_user_is_bot,
      content: r.content, fileUrl: r.file_url, fileName: r.file_name,
      isRead: r.is_read, createdAt: r.created_at,
    }))
  }

  async createDmMessage(workspaceId: string, fromUserId: string, toUserId: string, content: string, fileUrl?: string, fileName?: string): Promise<any> {
    const from = await this.getUserById(fromUserId)
    if (!from) throw new Error('User not found')
    const { rows } = await pool.query(
      `INSERT INTO dm_messages (workspace_id, from_user_id, to_user_id, from_user_name, from_user_is_bot, content, file_url, file_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [workspaceId, fromUserId, toUserId, from.name, from.isBot, content, fileUrl || null, fileName || null]
    )
    return { id: rows[0].id, fromUserId: rows[0].from_user_id, toUserId: rows[0].to_user_id, fromUserName: rows[0].from_user_name, fromUserIsBot: rows[0].from_user_is_bot, content: rows[0].content, fileUrl: rows[0].file_url, fileName: rows[0].file_name, isRead: rows[0].is_read, createdAt: rows[0].created_at }
  }

  // === Helpers ===
  private toUser(r: any): User {
    return { id: r.id, workspaceId: r.workspace_id, name: r.name, email: r.email, passwordHash: r.password_hash, role: r.role, avatarUrl: r.avatar_url, isBot: r.is_bot, createdAt: r.created_at }
  }
  private toChannel(r: any): Channel {
    return { id: r.id, workspaceId: r.workspace_id, name: r.name, description: r.description, isPrivate: r.is_private, memberCount: parseInt(r.member_count || 0), createdAt: r.created_at }
  }
  private toMessage(r: any): Message {
    return { id: r.id, channelId: r.channel_id, threadId: r.thread_id, senderId: r.sender_id, senderName: r.sender_name, senderIsBot: r.sender_is_bot, content: r.content, fileUrl: r.file_url, fileName: r.file_name, fileType: r.file_type, reactions: r.reactions || {}, replyCount: r.reply_count || 0, createdAt: r.created_at }
  }
  private toWorkspace(r: any): Workspace {
    return { id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, primaryColor: r.primary_color, createdAt: r.created_at }
  }
}

export const store = new Store()
export { DEFAULT_WS }
