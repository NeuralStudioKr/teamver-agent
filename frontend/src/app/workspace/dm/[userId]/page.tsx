'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { api, getApiBase } from '@/lib/api'
import { Send, ArrowLeft, Paperclip } from 'lucide-react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { renderWithDriveLinks } from '@/components/chat/DriveLinks'

export default function DmPage() {
  const { userId } = useParams<{ userId: string }>()
  const { socket, currentUser, members } = useWorkspace()
  const router = useRouter()
  const [messages, setMessages] = useState<any[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const typingTimerRef = useRef<any>(null)

  const partner = members.find(m => m.id === userId)

  useEffect(() => {
    if (!currentUser) return
    api.getDmMessages(userId).then(msgs => { setMessages(msgs ?? []); setLoading(false) }).catch(() => setLoading(false))
  }, [userId, currentUser])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (!socket) return
    const handleDm = (msg: any) => {
      if ((msg.fromUserId === userId && msg.toUserId === currentUser?.id) ||
          (msg.fromUserId === currentUser?.id && msg.toUserId === userId)) {
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
      }
    }
    const handleTyping = ({ userId: tuid, isTyping: t }: any) => {
      if (tuid === userId) { setIsTyping(t); if (t) setTimeout(() => setIsTyping(false), 3000) }
    }
    socket.on('new_dm', handleDm)
    socket.on('dm_user_typing', handleTyping)
    return () => { socket.off('new_dm', handleDm); socket.off('dm_user_typing', handleTyping) }
  }, [socket, userId, currentUser])

  const send = () => {
    if (!text.trim() || !socket) return
    socket.emit('send_dm', { toUserId: userId, content: text.trim() })
    setText('')
  }

  const handleTyping = () => {
    if (!socket) return
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      socket.emit('dm_typing', { toUserId: userId, isTyping: true })
      setTimeout(() => socket.emit('dm_typing', { toUserId: userId, isTyping: false }), 2000)
    }, 500)
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) return
        try {
          const { url, name } = await api.uploadFile(file)
          if (socket) socket.emit('send_dm', { toUserId: userId, content: '', fileUrl: url, fileName: name })
        } catch {}
      }
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-muted-foreground">로딩 중...</div>

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card/50">
        <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground p-1 rounded"><ArrowLeft size={18} /></button>
        <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center text-sm font-bold text-primary">
          {partner?.name?.[0] ?? '?'}
        </div>
        <div>
          <div className="font-semibold text-sm">{partner?.name ?? userId}</div>
          <div className="text-xs text-muted-foreground">{partner?.role ?? ''} {partner?.isBot ? '🤖' : ''}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-12">
            <p className="text-4xl mb-3">💬</p>
            <p>{partner?.name}님과 첫 대화를 시작해보세요!</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className="flex items-start gap-3 group">
            <div className="w-9 h-9 rounded-md bg-primary/30 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0 mt-0.5">
              {msg.fromUserName?.[0] ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-sm">{msg.fromUserName}</span>
                {msg.fromUserIsBot && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold">AI</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {format(new Date(msg.createdAt), 'HH:mm', { locale: ko })}
                </span>
              </div>
              {msg.fileUrl && msg.fileUrl.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                <img src={`${getApiBase()}${msg.fileUrl}`} className="rounded-lg max-w-md border border-border mt-1" alt={msg.fileName} />
              ) : msg.fileUrl ? (
                <a href={`${getApiBase()}${msg.fileUrl}`} target="_blank" className="inline-flex items-center gap-2 bg-accent rounded-lg px-3 py-2 text-sm hover:bg-accent/80 mt-1">
                  <Paperclip size={14} />{msg.fileName}
                </a>
              ) : null}
              {msg.content && (
                <div className="text-sm whitespace-pre-wrap break-words mt-0.5">{renderWithDriveLinks(msg.content)}</div>
              )}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/30 flex items-center justify-center text-xs">{partner?.name?.[0]}</div>
            <div className="bg-accent px-3 py-2 rounded-2xl text-sm text-muted-foreground">입력 중...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2 bg-secondary border border-border rounded-xl px-4 py-2 focus-within:border-ring/50">
          <input
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
            placeholder={`${partner?.name ?? ''}에게 메시지`}
            value={text}
            onChange={e => { setText(e.target.value); handleTyping() }}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            onPaste={handlePaste}
          />
          <button onClick={send} disabled={!text.trim()} className="w-7 h-7 rounded-lg bg-primary disabled:opacity-30 flex items-center justify-center hover:bg-primary/80 transition-colors">
            <Send size={14} className="text-primary-foreground" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-1 px-1">Ctrl+V로 이미지 붙여넣기 가능</p>
      </div>
    </div>
  )
}
