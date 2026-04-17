'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import { useWorkspace } from '@/lib/WorkspaceContext'
import MessageItem from './MessageItem'
import ThreadPanel from './ThreadPanel'
import { Send, Paperclip, Hash, Users, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatAreaProps {
  channelId: string
  socket: any
  currentUser: any
  apiBase: string
}

const EMOJI_LIST = ['👍','❤️','😂','😮','😢','🎉','🔥','💯']

export default function ChatArea({ channelId, socket, currentUser, apiBase }: ChatAreaProps) {
  const { channels } = useWorkspace()
  const activeChannel = channels.find(c => c.id === channelId)
  const channelName: string = activeChannel?.name || '채널'

  const [messages, setMessages] = useState<any[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeThread, setActiveThread] = useState<any>(null)
  const [thinking, setThinking] = useState<Record<string, boolean>>({})
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [channelMembers, setChannelMembers] = useState<any[]>([])
  const [showMembers, setShowMembers] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [allMembers, setAllMembers] = useState<any[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const typingTimerRef = useRef<any>(null)
  const dragCounterRef = useRef(0)

  // Thread panel resize
  const THREAD_MIN = 280
  const THREAD_MAX = 600
  const THREAD_DEFAULT = 320
  const [threadWidth, setThreadWidth] = useState(THREAD_DEFAULT)
  const threadResizingRef = useRef(false)

  useEffect(() => {
    const stored = Number(localStorage.getItem('ta_thread_width'))
    if (stored >= THREAD_MIN && stored <= THREAD_MAX) setThreadWidth(stored)
  }, [])

  const onThreadResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    threadResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const containerRight = (e.target as HTMLElement).parentElement?.getBoundingClientRect().right ?? window.innerWidth
    const onMove = (ev: MouseEvent) => {
      if (!threadResizingRef.current) return
      const next = Math.max(THREAD_MIN, Math.min(THREAD_MAX, containerRight - ev.clientX))
      setThreadWidth(next)
    }
    const onUp = () => {
      threadResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setThreadWidth(w => { try { localStorage.setItem('ta_thread_width', String(w)) } catch {} return w })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const loadMessages = useCallback(async () => {
    if (!channelId) return
    setLoading(true)
    try {
      const [msgs, members, all] = await Promise.all([
        api.getMessages(channelId),
        api.getChannelMembers(channelId),
        api.getMembers(),
      ])
      setMessages(msgs)
      setChannelMembers(members)
      setAllMembers(all)
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => { loadMessages() }, [loadMessages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (!socket) return
    const onMessage = (msg: any) => {
      if (msg.channelId === channelId && !msg.threadId) {
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
      }
    }
    const onThreadReply = ({ threadId, message }: any) => {
      setMessages(prev => prev.map(m => m.id === threadId ? { ...m, replyCount: (m.replyCount || 0) + 1 } : m))
      if (activeThread?.id === threadId) setActiveThread((t: any) => t ? { ...t, replies: [...(t.replies || []), message] } : t)
    }
    const onThinking = ({ agentId }: any) => setThinking(t => ({ ...t, [agentId]: true }))
    const onDoneThinking = ({ agentId }: any) => setThinking(t => ({ ...t, [agentId]: false }))
    const onTyping = ({ userId, userName, isTyping }: any) => {
      if (userId === currentUser?.id) return
      setTypingUsers(prev => isTyping ? (prev.includes(userName) ? prev : [...prev, userName]) : prev.filter(u => u !== userName))
    }
    const onReaction = (msg: any) => {
      if (msg.channelId === channelId) setMessages(prev => prev.map(m => m.id === msg.id ? msg : m))
    }
    const onMsgUpdated = (msg: any) => {
      if (msg.channelId === channelId) setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m))
    }
    const onMsgDeleted = ({ messageId }: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== messageId))
    }
    socket.on('new_message', onMessage)
    socket.on('thread_reply', onThreadReply)
    socket.on('ai_thinking', onThinking)
    socket.on('ai_done_thinking', onDoneThinking)
    socket.on('user_typing', onTyping)
    socket.on('reaction_updated', onReaction)
    socket.on('message_updated', onMsgUpdated)
    socket.on('message_deleted', onMsgDeleted)
    return () => {
      socket.off('new_message', onMessage)
      socket.off('thread_reply', onThreadReply)
      socket.off('ai_thinking', onThinking)
      socket.off('ai_done_thinking', onDoneThinking)
      socket.off('user_typing', onTyping)
      socket.off('reaction_updated', onReaction)
      socket.off('message_updated', onMsgUpdated)
      socket.off('message_deleted', onMsgDeleted)
    }
  }, [socket, channelId, activeThread, currentUser])

  const send = () => {
    if (!text.trim() || !socket || !channelId) return
    socket.emit('send_message', { channelId, content: text.trim() })
    setText('')
  }

  const handleTyping = () => {
    if (!socket) return
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      socket.emit('typing', { channelId, isTyping: true })
      setTimeout(() => socket.emit('typing', { channelId, isTyping: false }), 2000)
    }, 400)
  }

  const uploadAndSend = async (file: File) => {
    if (!socket || !channelId) return
    try {
      const { url, name, type } = await api.uploadFile(file)
      socket.emit('send_message', { channelId, content: '', fileUrl: url, fileName: name, fileType: type })
    } catch {}
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await uploadAndSend(file)
      }
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await uploadAndSend(file)
    e.target.value = ''
  }

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types || []).includes('Files')

  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) await uploadAndSend(f)
  }

  const openThread = async (msg: any) => {
    const replies = await api.getThreadReplies(msg.id)
    setActiveThread({ ...msg, replies })
  }

  const sendThreadReply = (content: string) => {
    if (!socket || !activeThread) return
    socket.emit('send_message', { channelId, content, threadId: activeThread.id })
  }

  const addReaction = async (messageId: string, emoji: string) => {
    try {
      const updated = await api.addReaction(messageId, emoji)
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: updated.reactions } : m))
    } catch {}
  }

  const editMessage = async (messageId: string, content: string) => {
    try {
      const updated = await api.updateMessage(channelId, messageId, content)
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, ...updated } : m))
    } catch {}
  }

  const deleteMessage = async (messageId: string) => {
    try {
      await api.deleteMessage(channelId, messageId)
      setMessages(prev => prev.filter(m => m.id !== messageId))
    } catch {}
  }

  if (!channelId) return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <p>채널을 선택하세요</p>
    </div>
  )

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      <div
        className="flex-1 flex flex-col min-w-0 relative"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 relative">
          <Hash size={18} className="text-muted-foreground flex-shrink-0" />
          <span className="font-semibold text-base flex-1 truncate" title={channelName}>{channelName}</span>
          <button
            onClick={() => { setShowMembers(v => !v); setShowInvite(false) }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
            title="채널 멤버"
          >
            <Users size={18} />
            <span>{channelMembers.length}명</span>
          </button>
          <button
            onClick={() => { setShowInvite(v => !v); setShowMembers(false) }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
            title="멤버 초대"
          >
            <UserPlus size={18} />
          </button>

          {/* 멤버 목록 패널 */}
          {showMembers && (
            <div className="absolute right-4 top-full mt-1 w-56 bg-card border border-border rounded-xl shadow-lg z-20 p-2">
              <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                <span className="text-xs font-semibold text-muted-foreground">채널 멤버 ({channelMembers.length})</span>
                <button onClick={() => setShowMembers(false)}><X size={12} className="text-muted-foreground" /></button>
              </div>
              {channelMembers.map(m => (
                <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/40">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold flex-shrink-0">{m.name[0]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{m.name}</div>
                    {m.email && <div className="text-[11px] text-muted-foreground truncate">{m.email}</div>}
                  </div>
                  {m.isBot && <span className="text-xs text-muted-foreground opacity-60">AI</span>}
                </div>
              ))}
            </div>
          )}

          {/* 초대 패널 */}
          {showInvite && (
            <div className="absolute right-4 top-full mt-1 w-56 bg-card border border-border rounded-xl shadow-lg z-20 p-2">
              <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                <span className="text-xs font-semibold text-muted-foreground">멤버 초대</span>
                <button onClick={() => setShowInvite(false)}><X size={12} className="text-muted-foreground" /></button>
              </div>
              {allMembers.filter(m => !channelMembers.find(cm => cm.id === m.id)).map(m => (
                <button
                  key={m.id}
                  onClick={async () => {
                    await api.inviteChannelMember(channelId, m.id)
                    const updated = await api.getChannelMembers(channelId)
                    setChannelMembers(updated)
                  }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-accent/40 text-left"
                >
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold flex-shrink-0">{m.name[0]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{m.name}</div>
                    {m.email && <div className="text-[11px] text-muted-foreground truncate">{m.email}</div>}
                  </div>
                  {m.isBot && <span className="text-xs text-muted-foreground opacity-60">AI</span>}
                </button>
              ))}
              {allMembers.filter(m => !channelMembers.find(cm => cm.id === m.id)).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">모든 멤버가 이미 참여 중</p>
              )}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          {loading && <div className="text-center text-muted-foreground text-sm py-4">로딩 중...</div>}
          {messages.map(msg => (
            <MessageItem
              key={msg.id}
              message={msg}
              currentUserId={currentUser?.id}
              apiBase={apiBase}
              onThread={() => openThread(msg)}
              onReaction={(emoji) => addReaction(msg.id, emoji)}
              onEdit={editMessage}
              onDelete={deleteMessage}
              emojiList={EMOJI_LIST}
            />
          ))}
          {Object.entries(thinking).filter(([, v]) => v).map(([agentId]) => (
            <div key={agentId} className="flex items-center gap-2 px-2 py-1">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs">AI</div>
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          ))}
          {typingUsers.length > 0 && (
            <p className="text-xs text-muted-foreground px-2">{typingUsers.join(', ')} 님이 입력 중...</p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-end gap-2 bg-secondary border border-border rounded-xl px-4 py-2.5 focus-within:border-ring/50">
            <label className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5">
              <Paperclip size={16} />
              <input type="file" className="hidden" onChange={handleFileSelect} accept="*/*" />
            </label>
            <textarea
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none resize-none max-h-32 min-h-[24px]"
              placeholder="메시지 입력... (Ctrl+V 붙여넣기 · 파일을 끌어다 놓을 수 있어요)"
              value={text} rows={1}
              onChange={e => { setText(e.target.value); handleTyping() }}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
              onPaste={handlePaste}
            />
            <button onClick={send} disabled={!text.trim()} className="w-7 h-7 rounded-lg bg-primary disabled:opacity-30 flex items-center justify-center hover:bg-primary/80 transition-colors flex-shrink-0">
              <Send size={14} className="text-primary-foreground" />
            </button>
          </div>
        </div>

        {/* Drag overlay */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-opacity',
            isDragging ? 'opacity-100' : 'opacity-0'
          )}
        >
          <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]" />
          <div className="relative flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-card/90 border border-primary shadow-xl">
            <Paperclip size={24} className="text-primary" />
            <p className="text-sm font-semibold text-foreground">파일을 여기에 놓으세요</p>
            <p className="text-xs text-muted-foreground">#{channelName} 채널에 업로드</p>
          </div>
        </div>
      </div>

      {activeThread && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={onThreadResizeStart}
            onDoubleClick={() => { setThreadWidth(THREAD_DEFAULT); try { localStorage.setItem('ta_thread_width', String(THREAD_DEFAULT)) } catch {} }}
            title="드래그해서 너비 조절 · 더블클릭으로 기본값"
            className="w-1 flex-shrink-0 cursor-col-resize bg-border hover:bg-primary/60 active:bg-primary transition-colors"
          />
          <ThreadPanel
            thread={activeThread}
            currentUser={currentUser}
            apiBase={apiBase}
            onClose={() => setActiveThread(null)}
            onReply={sendThreadReply}
            socket={socket}
            channelId={channelId}
            width={threadWidth}
          />
        </>
      )}
    </div>
  )
}
