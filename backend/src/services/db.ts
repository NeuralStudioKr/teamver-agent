import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

export async function initDB() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(50) UNIQUE NOT NULL,
        logo_url TEXT,
        primary_color VARCHAR(7) DEFAULT '#6366f1',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) DEFAULT '',
        role VARCHAR(50) DEFAULT 'member',
        avatar_url TEXT,
        is_bot BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(workspace_id, email)
      );

      CREATE TABLE IF NOT EXISTS channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        is_private BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (channel_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
        thread_id UUID REFERENCES messages(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
        sender_name VARCHAR(100) NOT NULL,
        sender_is_bot BOOLEAN DEFAULT false,
        content TEXT,
        file_url TEXT,
        file_name VARCHAR(255),
        file_type VARCHAR(100),
        reactions JSONB DEFAULT '{}',
        reply_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS dm_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
        from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        from_user_name VARCHAR(100) NOT NULL,
        from_user_is_bot BOOLEAN DEFAULT false,
        content TEXT,
        file_url TEXT,
        file_name VARCHAR(255),
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_dm_messages_users ON dm_messages(from_user_id, to_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS drive_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) DEFAULT 'text/markdown',
        size INT DEFAULT 0,
        content TEXT,
        file_url TEXT,
        created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_by_name VARCHAR(100) NOT NULL DEFAULT '알 수 없음',
        tags TEXT[] DEFAULT '{}',
        description TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_drive_files_workspace ON drive_files(workspace_id, updated_at DESC);
    `)

    // Seed default workspace
    const wsResult = await client.query(`
      INSERT INTO workspaces (id, name, slug) VALUES
        ('00000000-0000-0000-0000-000000000000', 'NeuralStudio', 'neuralstudio')
      ON CONFLICT (slug) DO NOTHING RETURNING id
    `)

    const wsId = '00000000-0000-0000-0000-000000000000'

    // Seed AI employees (with password so OpenClaw agents can log in)
    const botPassword = await bcrypt.hash('teamver2025!', 10)
    await client.query(`
      INSERT INTO users (id, workspace_id, name, email, password_hash, role, is_bot) VALUES
        ('00000000-0000-0000-0000-000000000001', $1, '이대표', 'ceo@teamver.ai', $2, '대표', true),
        ('00000000-0000-0000-0000-000000000002', $1, '한이사', 'director@teamver.ai', $2, '이사', true),
        ('00000000-0000-0000-0000-000000000003', $1, '이본부장', 'chief@teamver.ai', $2, '본부장', true)
      ON CONFLICT (workspace_id, email) DO UPDATE SET password_hash=$2
    `, [wsId, botPassword])

    // Seed channels — workspace_id+name 기준으로 중복 방지
    await client.query(`
      INSERT INTO channels (workspace_id, name, description)
      SELECT $1, 'general', '일반 채널'
      WHERE NOT EXISTS (SELECT 1 FROM channels WHERE workspace_id=$1 AND name='general')
    `, [wsId])
    await client.query(`
      INSERT INTO channels (workspace_id, name, description)
      SELECT $1, '개발', '개발 채널'
      WHERE NOT EXISTS (SELECT 1 FROM channels WHERE workspace_id=$1 AND name='개발')
    `, [wsId])

    console.log('✅ Database initialized')
  } finally {
    client.release()
  }
}
