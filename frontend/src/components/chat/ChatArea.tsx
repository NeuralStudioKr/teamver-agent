'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import MessageItem from './MessageItem'
import ThreadPanel from './ThreadPanel'
import { Send, Paperclip, Smile, Hash } from 'lucide-react'

interface ChatAreaProps {
  channelId: string
  socket: any
  currentUser: any
  apiBase: string
}

const EMOJI_LIST = ['👍','❤️','😂','😮','😢','🎉','🔥','💯']

export default function ChatArea({ channelId, socket, currentUser, apiBase }: ChatAreaProps) {
  const [messages, setMessages] = useState<any[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeThread, setActiveThread] = useState<any>(null)
  const [thinking, setThinking] = useState<Record<string, boolean>>({})
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const typingTimerRef = useRef<any>(null)

  const loadMessages = useCallback(async () => {
    if (!channelId) return
    setLoading(true)
    try {
      const msgs = await api.getMessages(channelId)
      setMessages(msgs)
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
    socket.on('new_message', onMessage)
    socket.on('thread_reply', onThreadReply)
    socket.on('ai_thinking', onThinking)
    socket.on('ai_done_thinking', onDoneThinking)
    socket.on('user_typing', onTyping)
    socket.on('reaction_updated', onReaction)
    return () => {
      socket.off('new_message', onMessage)
      socket.off('thread_reply', onThreadReply)
      socket.off('ai_thinking', onThinking)
      socket.off('ai_done_thinking', onDoneThinking)
      socket.off('user_typing', onTyping)
      socket.off('reaction_updated', onReaction)
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

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file || !socket) return
        try {
          const { url, name, type } = await api.uploadFile(file)
          socket.emit('send_message', { channelId, content: '', fileUrl: url, fileName: name, fileType: type })
        } catch {}
      }
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !socket) return
    try {
      const { url, name, type } = await api.uploadFile(file)
      socket.emit('send_message', { channelId, content: '', fileUrl: url, fileName: name, fileType: type })
    } catch {}
    e.target.value = ''
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

  if (!channelId) return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <p>채널을 선택하세요</p>
    </div>
  )

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Hash size={16} className="text-muted-foreground" />
          <span className="font-semibold text-sm">채널</span>
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
              <input type="file" className="hidden" onChange={handleFileSelect} accept="image/*,.pdf,.doc,.docx,.txt" />
            </label>
            <textarea
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none resize-none max-h-32 min-h-[24px]"
              placeholder="메시지 입력... (Ctrl+V로 이미지 붙여넣기)"
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
      </div>

      {activeThread && (
        <ThreadPanel
          thread={activeThread}
          currentUser={currentUser}
          apiBase={apiBase}
          onClose={() => setActiveThread(null)}
          onReply={sendThreadReply}
          socket={socket}
          channelId={channelId}
        />
      )}
    </div>
  )
}
