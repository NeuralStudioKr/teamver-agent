import type { FastifyInstance } from 'fastify'
import { pool } from '../services/db.js'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'

const DRIVE_DIR = '/tmp/drive'

export async function driveRoutes(app: FastifyInstance) {
  if (!fs.existsSync(DRIVE_DIR)) fs.mkdirSync(DRIVE_DIR, { recursive: true })

  // 파일 목록 조회
  app.get('/drive/files', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const { search, tag } = req.query as any

    let query = `
      SELECT id, workspace_id, name, mime_type, size, content, file_url,
             created_by_id, created_by_name, tags, description,
             created_at, updated_at
      FROM drive_files
      WHERE workspace_id = $1
    `
    const params: any[] = [user.workspaceId]

    if (search) {
      query += ` AND (name ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`
      params.push(`%${search}%`)
    }
    if (tag) {
      query += ` AND $${params.length + 1} = ANY(tags)`
      params.push(tag)
    }
    query += ` ORDER BY updated_at DESC`

    const result = await pool.query(query, params)
    return result.rows
  })

  // 단일 파일 조회
  app.get('/drive/files/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const { id } = req.params as any

    const result = await pool.query(
      `SELECT * FROM drive_files WHERE id = $1 AND workspace_id = $2`,
      [id, user.workspaceId]
    )
    if (!result.rows[0]) return reply.status(404).send({ error: '파일을 찾을 수 없습니다' })

    const file = result.rows[0]
    // 바이너리 파일이면 file_url 반환, 텍스트면 content 포함
    return file
  })

  // 텍스트/MD 파일 생성 (AI/사용자)
  app.post('/drive/files', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const { name, content, mime_type, tags, description } = req.body as any

    if (!name) return reply.status(400).send({ error: '파일 이름 필요' })

    const mimeType = mime_type || 'text/markdown'
    const size = Buffer.byteLength(content || '', 'utf8')

    const result = await pool.query(
      `INSERT INTO drive_files
         (id, workspace_id, name, mime_type, size, content, created_by_id, created_by_name, tags, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        uuidv4(),
        user.workspaceId,
        name,
        mimeType,
        size,
        content || '',
        user.id,
        user.name,
        tags || [],
        description || '',
      ]
    )
    reply.status(201)
    return result.rows[0]
  })

  // 파일 업로드 (바이너리: 이미지, PDF 등)
  app.post('/drive/upload', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const parts = req.parts()

    let fileData: any = null
    let meta: Record<string, string> = {}

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename)
        const fileId = uuidv4()
        const filename = `${fileId}${ext}`
        const filepath = path.join(DRIVE_DIR, filename)
        const chunks: Buffer[] = []
        for await (const chunk of part.file) chunks.push(chunk)
        const buf = Buffer.concat(chunks)
        fs.writeFileSync(filepath, buf)
        fileData = {
          originalName: part.filename,
          mimetype: part.mimetype,
          size: buf.length,
          fileUrl: `/drive/static/${filename}`,
        }
      } else {
        meta[part.fieldname] = (part as any).value
      }
    }

    if (!fileData) return reply.status(400).send({ error: '파일 없음' })

    const result = await pool.query(
      `INSERT INTO drive_files
         (id, workspace_id, name, mime_type, size, file_url, created_by_id, created_by_name, tags, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        uuidv4(),
        user.workspaceId,
        meta.name || fileData.originalName,
        fileData.mimetype,
        fileData.size,
        fileData.fileUrl,
        user.id,
        user.name,
        meta.tags ? JSON.parse(meta.tags) : [],
        meta.description || '',
      ]
    )
    reply.status(201)
    return result.rows[0]
  })

  // 파일 수정 (내용 업데이트)
  app.patch('/drive/files/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const { id } = req.params as any
    const { name, content, tags, description } = req.body as any

    const existing = await pool.query(
      `SELECT * FROM drive_files WHERE id = $1 AND workspace_id = $2`,
      [id, user.workspaceId]
    )
    if (!existing.rows[0]) return reply.status(404).send({ error: '파일을 찾을 수 없습니다' })

    const size = content !== undefined ? Buffer.byteLength(content, 'utf8') : existing.rows[0].size

    const result = await pool.query(
      `UPDATE drive_files
       SET name = COALESCE($1, name),
           content = COALESCE($2, content),
           size = $3,
           tags = COALESCE($4, tags),
           description = COALESCE($5, description),
           updated_at = NOW()
       WHERE id = $6 AND workspace_id = $7
       RETURNING *`,
      [name, content, size, tags, description, id, user.workspaceId]
    )
    return result.rows[0]
  })

  // 파일 삭제
  app.delete('/drive/files/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const { id } = req.params as any

    const existing = await pool.query(
      `SELECT * FROM drive_files WHERE id = $1 AND workspace_id = $2`,
      [id, user.workspaceId]
    )
    if (!existing.rows[0]) return reply.status(404).send({ error: '파일을 찾을 수 없습니다' })

    // 바이너리 파일이면 디스크에서도 삭제
    const file = existing.rows[0]
    if (file.file_url) {
      const filename = path.basename(file.file_url)
      const filepath = path.join(DRIVE_DIR, filename)
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
    }

    await pool.query(`DELETE FROM drive_files WHERE id = $1`, [id])
    return { success: true }
  })

  // 바이너리 파일 서빙
  app.get('/drive/static/:filename', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { filename } = req.params as any
    const filepath = path.join(DRIVE_DIR, filename)
    if (!fs.existsSync(filepath)) return reply.status(404).send({ error: '파일 없음' })
    return reply.sendFile(filename, DRIVE_DIR)
  })
}
