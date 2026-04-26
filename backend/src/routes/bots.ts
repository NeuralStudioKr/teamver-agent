import type { FastifyInstance } from 'fastify'
import { spawn } from 'child_process'

const BOT_CONTAINERS: Record<string, string> = {
  '00000000-0000-0000-0000-000000000001': 'ta-oc-coordinator',
  '00000000-0000-0000-0000-000000000002': 'ta-oc-writer',
  '00000000-0000-0000-0000-000000000003': 'ta-oc-reviewer',
}

function execDocker(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }))
  })
}

export async function botRoutes(app: FastifyInstance) {
  app.post('/api/bots/:botId/pause', { onRequest: [(app as any).authenticate] }, async (req: any, reply: any) => {
    const { botId } = req.params as { botId: string }
    const containerName = BOT_CONTAINERS[botId]

    if (!containerName) {
      return reply.status(404).send({ error: '봇을 찾을 수 없습니다.' })
    }

    const result = await execDocker(['stop', containerName])
    if (result.code !== 0) {
      ;(app as any).log.error(`Failed to pause bot ${botId}: ${result.stderr}`)
      return reply.status(500).send({ error: '봇 일시중지 실패' })
    }

    ;(app as any).log.info(`Bot ${botId} (${containerName}) paused`)
    return { ok: true, status: 'paused' }
  })

  app.post('/api/bots/:botId/restart', { onRequest: [(app as any).authenticate] }, async (req: any, reply: any) => {
    const { botId } = req.params as { botId: string }
    const containerName = BOT_CONTAINERS[botId]

    if (!containerName) {
      return reply.status(404).send({ error: '봇을 찾을 수 없습니다.' })
    }

    const startResult = await execDocker(['start', containerName])
    if (startResult.code !== 0) {
      ;(app as any).log.error(`Failed to restart bot ${botId}: ${startResult.stderr}`)
      return reply.status(500).send({ error: '봇 재시작 실패' })
    }

    ;(app as any).log.info(`Bot ${botId} (${containerName}) restarted`)
    return { ok: true, status: 'running' }
  })

  app.get('/api/bots/:botId/status', { onRequest: [(app as any).authenticate] }, async (req: any, reply: any) => {
    const { botId } = req.params as { botId: string }
    const containerName = BOT_CONTAINERS[botId]

    if (!containerName) {
      return reply.status(404).send({ error: '봇을 찾을 수 없습니다.' })
    }

    const result = await execDocker(['inspect', '-f', '{{.State.Status}}', containerName])
    if (result.code !== 0) {
      return { status: 'unknown' }
    }

    const dockerStatus = result.stdout.trim()
    const status = dockerStatus === 'running' ? 'running' : 'paused'
    return { status }
  })
}
