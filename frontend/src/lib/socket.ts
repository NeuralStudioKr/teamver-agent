import { io, Socket } from 'socket.io-client'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
let socket: Socket | null = null
let currentToken: string | null = null

export function getSocket(token: string): Socket {
  // 토큰이 변경된 경우 재연결
  if (socket && currentToken !== token) {
    socket.disconnect()
    socket = null
    currentToken = null
  }

  if (!socket) {
    currentToken = token
    socket = io(BASE, {
      auth: { token },
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    // 재연결 시 토큰 업데이트
    socket.on('reconnect_attempt', () => {
      if (socket && currentToken) {
        socket.auth = { token: currentToken }
      }
    })

    socket.on('connect_error', (err) => {
      console.error('[socket] 연결 오류:', err.message)
    })
  }

  return socket
}

export function updateSocketToken(token: string) {
  currentToken = token
  if (socket) {
    socket.auth = { token }
    socket.disconnect().connect()
  }
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
    currentToken = null
  }
}
