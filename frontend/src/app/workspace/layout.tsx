'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { getSocket, disconnectSocket } from '@/lib/socket'
import { WorkspaceContext } from '@/lib/WorkspaceContext'
import Sidebar from '@/components/layout/Sidebar'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 240
const SIDEBAR_STORAGE_KEY = 'ta_sidebar_width'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [workspace, setWorkspace] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [channels, setChannels] = useState<any[]>([])
  const [activeChannel, setActiveChannel] = useState('')
  const [socket, setSocket] = useState<any>(null)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const resizingRef = useRef(false)

  useEffect(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY))
    if (stored && stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX) setSidebarWidth(stored)
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('ta_token')
    if (!token) { router.replace('/login'); return }

    Promise.all([api.me(), api.getWorkspace(), api.getChannels(), api.getMembers()])
      .then(([user, ws, chs, mems]) => {
        setCurrentUser(user)
        setWorkspace(ws)
        setChannels(chs)
        setMembers(mems)
        if (chs.length > 0) setActiveChannel(chs[0].id)

        const s = getSocket(token)
        setSocket(s)
        chs.forEach(ch => s.emit('join_channel', ch.id))
      })
      .catch(() => { localStorage.removeItem('ta_token'); router.replace('/login') })

    return () => disconnectSocket()
  }, [])

  const handleChannelSelect = useCallback((channelId: string) => {
    setActiveChannel(channelId)
    router.push('/workspace')
  }, [router])

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, ev.clientX))
      setSidebarWidth(next)
    }
    const onUp = () => {
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setSidebarWidth(w => {
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(w)) } catch {}
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">로딩 중...</div>
      </div>
    )
  }

  return (
    <WorkspaceContext.Provider value={{ activeChannel, setActiveChannel, socket, currentUser, workspace, members, channels }}>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar
          workspace={workspace}
          channels={channels}
          members={members}
          activeChannel={activeChannel}
          onChannelSelect={handleChannelSelect}
          currentUser={currentUser}
          onChannelsUpdate={setChannels}
          width={sidebarWidth}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={onResizeStart}
          onDoubleClick={() => {
            setSidebarWidth(SIDEBAR_DEFAULT)
            try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(SIDEBAR_DEFAULT)) } catch {}
          }}
          title="드래그해서 너비 조절 · 더블클릭으로 기본값"
          className="w-1 flex-shrink-0 cursor-col-resize bg-border hover:bg-primary/60 active:bg-primary transition-colors"
        />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
