'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Hash, Plus, ChevronDown, ChevronRight, HardDrive, Sun, Moon, MoreVertical, Pencil, Trash2, Pause, Play, RefreshCw } from 'lucide-react'
import { api, getApiBase } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/WorkspaceContext'

interface SidebarProps {
  workspace: any
  channels: any[]
  members: any[]
  activeChannel: string
  onChannelSelect: (id: string) => void
  currentUser: any
  onChannelsUpdate: (chs: any[]) => void
  width?: number
}

const BOT_ROLE_LABEL: Record<string, string> = {
  '00000000-0000-0000-0000-000000000001': '조율자',
  '00000000-0000-0000-0000-000000000002': '작성자',
  '00000000-0000-0000-0000-000000000003': '검수자',
}

export default function Sidebar({ workspace, channels, members, activeChannel, onChannelSelect, currentUser, onChannelsUpdate, width }: SidebarProps) {
  const pathname = usePathname()
  const { socket } = useWorkspace()
  const [showChannels, setShowChannels] = useState(true)
  const [showDMs, setShowDMs] = useState(true)
  const [newCh, setNewCh] = useState('')
  const [showNewCh, setShowNewCh] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [menuForCh, setMenuForCh] = useState<string | null>(null)
  const [renameForCh, setRenameForCh] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteForCh, setDeleteForCh] = useState<any | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuForBot, setMenuForBot] = useState<string | null>(null)
  const [botStatuses, setBotStatuses] = useState<Record<string, 'running' | 'paused'>>({})
  const menuRef = useRef<HTMLDivElement>(null)
  const botMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuForCh && !menuForBot) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuForCh(null)
      if (botMenuRef.current && !botMenuRef.current.contains(e.target as Node)) setMenuForBot(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuForCh, menuForBot])

  useEffect(() => {
    const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    setTheme(current)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    if (next === 'dark') document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    try { localStorage.setItem('ta_theme', next) } catch {}
  }

  const addChannel = async () => {
    if (!newCh.trim()) return
    try {
      const ch = await api.createChannel(newCh.trim())
      onChannelsUpdate([...channels, ch])
      // 즉시 socket room 조인 — 새 채널에서 본인 메시지가 실시간으로 보이도록
      if (socket) socket.emit('join_channel', ch.id)
      onChannelSelect(ch.id)
      setNewCh('')
      setShowNewCh(false)
    } catch {}
  }

  const startRename = (ch: any) => {
    setMenuForCh(null)
    setRenameForCh(ch.id)
    setRenameDraft(ch.name)
  }

  const submitRename = async () => {
    const id = renameForCh
    const name = renameDraft.trim()
    if (!id || !name) { setRenameForCh(null); return }
    const current = channels.find(c => c.id === id)
    if (current && current.name === name) { setRenameForCh(null); return }
    setBusy(true)
    try {
      const updated = await api.renameChannel(id, name)
      onChannelsUpdate(channels.map(c => c.id === id ? { ...c, ...updated } : c))
    } catch (e: any) {
      alert(e?.message || '채널명 변경 실패')
    } finally {
      setBusy(false)
      setRenameForCh(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteForCh) return
    setBusy(true)
    try {
      await api.deleteChannel(deleteForCh.id)
      const remaining = channels.filter(c => c.id !== deleteForCh.id)
      onChannelsUpdate(remaining)
      if (activeChannel === deleteForCh.id && remaining[0]) onChannelSelect(remaining[0].id)
    } catch (e: any) {
      alert(e?.message || '채널 삭제 실패')
    } finally {
      setBusy(false)
      setDeleteForCh(null)
    }
  }

  const pauseBot = async (botId: string, botName: string) => {
    setMenuForBot(null)
    if (!confirm(`${botName} 봇을 일시중지하시겠습니까?`)) return
    setBusy(true)
    try {
      await api.pauseBot(botId)
      setBotStatuses(prev => ({ ...prev, [botId]: 'paused' }))
      alert(`${botName} 봇이 일시중지되었습니다.`)
    } catch (e: any) {
      alert(e?.message || '일시중지 실패')
    } finally {
      setBusy(false)
    }
  }

  const restartBot = async (botId: string, botName: string) => {
    setMenuForBot(null)
    if (!confirm(`${botName} 봇을 재시작하시겠습니까?`)) return
    setBusy(true)
    try {
      await api.restartBot(botId)
      setBotStatuses(prev => ({ ...prev, [botId]: 'running' }))
      alert(`${botName} 봇이 재시작되었습니다.`)
    } catch (e: any) {
      alert(e?.message || '재시작 실패')
    } finally {
      setBusy(false)
    }
  }

  const primaryColor = workspace?.primaryColor || '#6366f1'

  return (
    <div
      className="flex-shrink-0 flex flex-col h-full"
      style={{ background: 'hsl(var(--sidebar))', width: width ?? 240 }}
    >
      {/* Header */}
      <div className="px-4 py-4 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          {workspace?.logoUrl ? (
            <img src={`${getApiBase()}${workspace.logoUrl}`} className="w-8 h-8 rounded-lg object-cover" alt="logo" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm text-white"
              style={{ background: primaryColor }}>
              {workspace?.name?.[0] ?? 'T'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{workspace?.name ?? 'Workspace'}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Drive */}
        <div className="px-2 mb-2">
          <Link
            href="/workspace/drive"
            className={cn(
              'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors',
              pathname === '/workspace/drive'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <HardDrive size={14} className="flex-shrink-0" />
            <span className="truncate">드라이브</span>
          </Link>
        </div>

        {/* Channels */}
        <div className="px-2 mb-2">
          <button
            onClick={() => setShowChannels(v => !v)}
            className="flex items-center gap-1 w-full text-xs font-semibold text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
          >
            {showChannels ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            채널
          </button>
          {showChannels && (
            <div className="mt-1 space-y-0.5">
              {channels.map(ch => {
                const isActive = activeChannel === ch.id && pathname === '/workspace'
                const rowClass = cn(
                  'group relative flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors',
                  isActive ? 'bg-primary/20 text-primary font-medium'
                           : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )
                if (renameForCh === ch.id) {
                  return (
                    <div key={ch.id} className={rowClass}>
                      <Hash size={14} className="flex-shrink-0" />
                      <input
                        value={renameDraft}
                        onChange={e => setRenameDraft(e.target.value)}
                        autoFocus
                        disabled={busy}
                        onKeyDown={e => {
                          if (e.key === 'Enter') submitRename()
                          if (e.key === 'Escape') setRenameForCh(null)
                        }}
                        onBlur={submitRename}
                        className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  )
                }
                return (
                  <div key={ch.id} className={rowClass}>
                    <button
                      onClick={() => onChannelSelect(ch.id)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <Hash size={14} className="flex-shrink-0" />
                      <span className="truncate">{ch.name}</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuForCh(menuForCh === ch.id ? null : ch.id) }}
                      title="채널 옵션"
                      className={cn(
                        'flex-shrink-0 p-0.5 rounded hover:bg-accent/70 transition-opacity',
                        menuForCh === ch.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                    >
                      <MoreVertical size={14} />
                    </button>
                    {menuForCh === ch.id && (
                      <div
                        ref={menuRef}
                        className="absolute right-1 top-full mt-1 z-30 min-w-[140px] bg-card border border-border rounded-lg shadow-lg py-1"
                      >
                        <button
                          onClick={() => startRename(ch)}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-foreground hover:bg-accent/60 text-left"
                        >
                          <Pencil size={13} />채널명 변경
                        </button>
                        <button
                          onClick={() => { setMenuForCh(null); setDeleteForCh(ch) }}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 text-left"
                        >
                          <Trash2 size={13} />채널 삭제
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {showNewCh ? (
                <div className="flex items-center gap-1 px-2">
                  <input
                    value={newCh} onChange={e => setNewCh(e.target.value)} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') addChannel(); if (e.key === 'Escape') setShowNewCh(false) }}
                    placeholder="채널 이름..."
                    className="flex-1 bg-secondary border border-border rounded px-2 py-1 text-xs outline-none"
                  />
                  <button onClick={addChannel} className="text-xs text-primary hover:underline">추가</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewCh(true)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                  <Plus size={12} />채널 추가
                </button>
              )}
            </div>
          )}
        </div>

        {/* DMs */}
        <div className="px-2">
          <button
            onClick={() => setShowDMs(v => !v)}
            className="flex items-center gap-1 w-full text-xs font-semibold text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
          >
            {showDMs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            다이렉트 메시지
          </button>
          {showDMs && (
            <div className="mt-1 space-y-0.5">
              {members.filter(m => m.id !== currentUser?.id).map(member => {
                const isDmActive = pathname === `/workspace/dm/${member.id}`
                const isBot = member.isBot
                const botStatus = botStatuses[member.id] || 'running'
                return (
                  <div key={member.id} className="group relative flex items-center">
                    <Link
                      href={`/workspace/dm/${member.id}`}
                      className={cn(
                        'flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 rounded-md text-sm transition-colors',
                        isDmActive ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                        botStatus === 'paused' ? 'bg-destructive/20' : 'bg-primary/20'
                      )}>
                        {member.name[0]}
                      </div>
                      <span className="truncate">{member.name}{isBot && BOT_ROLE_LABEL[member.id] ? ` (${BOT_ROLE_LABEL[member.id]})` : ''}</span>
                      {isBot && (
                        <span className={cn(
                          "text-xs flex-shrink-0 ml-auto",
                          botStatus === 'paused' ? 'text-destructive' : 'text-muted-foreground opacity-60'
                        )}>
                          {botStatus === 'paused' ? '중지' : 'AI'}
                        </span>
                      )}
                    </Link>
                    {isBot && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuForBot(menuForBot === member.id ? null : member.id) }}
                        title="봇 옵션"
                        className={cn(
                          'flex-shrink-0 p-1 rounded hover:bg-accent/70 transition-opacity mr-1',
                          menuForBot === member.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        )}
                      >
                        <MoreVertical size={14} />
                      </button>
                    )}
                    {menuForBot === member.id && (
                      <div
                        ref={botMenuRef}
                        className="absolute right-0 top-full mt-1 z-30 min-w-[140px] bg-card border border-border rounded-lg shadow-lg py-1"
                      >
                        {botStatus === 'running' ? (
                          <button
                            onClick={() => pauseBot(member.id, member.name)}
                            disabled={busy}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-foreground hover:bg-accent/60 text-left"
                          >
                            <Pause size={13} />일시중지
                          </button>
                        ) : (
                          <button
                            onClick={() => restartBot(member.id, member.name)}
                            disabled={busy}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-foreground hover:bg-accent/60 text-left"
                          >
                            <Play size={13} />재시작
                          </button>
                        )}
                        <button
                          onClick={() => restartBot(member.id, member.name)}
                          disabled={busy}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-foreground hover:bg-accent/60 text-left"
                        >
                          <RefreshCw size={13} />게이트웨이 재시작
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-border/50 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold flex-shrink-0">
          {currentUser?.name?.[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{currentUser?.name}</div>
          <div className="text-xs text-muted-foreground truncate">{currentUser?.role}</div>
        </div>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent/50 transition-colors"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* 채널 삭제 확인 모달 */}
      {deleteForCh && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => !busy && setDeleteForCh(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-1">채널 삭제</h3>
            <p className="text-sm text-muted-foreground mb-4">
              <span className="font-medium text-foreground">#{deleteForCh.name}</span> 채널과 그 안의 모든 메시지·스레드가 영구 삭제됩니다. 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteForCh(null)}
                disabled={busy}
                className="flex-1 px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent/50 transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                disabled={busy}
                className="flex-1 px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {busy ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
