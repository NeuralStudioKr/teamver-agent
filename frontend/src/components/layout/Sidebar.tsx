'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Hash, Plus, ChevronDown, ChevronRight, LogOut, UserX, HardDrive } from 'lucide-react'
import { api, clearToken, getApiBase } from '@/lib/api'
import { cn } from '@/lib/utils'

interface SidebarProps {
  workspace: any
  channels: any[]
  members: any[]
  activeChannel: string
  onChannelSelect: (id: string) => void
  currentUser: any
  onChannelsUpdate: (chs: any[]) => void
}

export default function Sidebar({ workspace, channels, members, activeChannel, onChannelSelect, currentUser, onChannelsUpdate }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [showChannels, setShowChannels] = useState(true)
  const [showDMs, setShowDMs] = useState(true)
  const [newCh, setNewCh] = useState('')
  const [showNewCh, setShowNewCh] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const addChannel = async () => {
    if (!newCh.trim()) return
    try {
      const ch = await api.createChannel(newCh.trim())
      onChannelsUpdate([...channels, ch])
      onChannelSelect(ch.id)
      setNewCh('')
      setShowNewCh(false)
    } catch {}
  }

  const logout = () => { clearToken(); router.push('/login') }

  const handleDeleteAccount = async () => {
    if (!deletePassword) { setDeleteError('비밀번호를 입력해주세요.'); return }
    setDeleting(true); setDeleteError('')
    try {
      await api.deleteAccount(deletePassword)
      clearToken()
      router.push('/login')
    } catch (e: any) {
      setDeleteError(e.message || '탈퇴 실패')
    } finally {
      setDeleting(false)
    }
  }

  const primaryColor = workspace?.primaryColor || '#6366f1'

  return (
    <div className="w-60 flex-shrink-0 flex flex-col h-full" style={{ background: 'hsl(var(--sidebar))' }}>
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
              {channels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => onChannelSelect(ch.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors',
                    activeChannel === ch.id && pathname === '/workspace'
                      ? 'bg-primary/20 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <Hash size={14} className="flex-shrink-0" />
                  <span className="truncate">{ch.name}</span>
                </button>
              ))}
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
                return (
                  <Link
                    key={member.id}
                    href={`/workspace/dm/${member.id}`}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors',
                      isDmActive ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    )}
                  >
                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {member.name[0]}
                    </div>
                    <span className="truncate">{member.name}</span>
                    {member.isBot && <span className="text-xs text-muted-foreground ml-auto opacity-60">AI</span>}
                  </Link>
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
        <button onClick={() => setShowDeleteModal(true)} title="회원탈퇴" className="text-muted-foreground hover:text-destructive p-1 rounded-md hover:bg-accent/50 transition-colors">
          <UserX size={14} />
        </button>
        <button onClick={logout} title="로그아웃" className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent/50 transition-colors">
          <LogOut size={14} />
        </button>
      </div>

      {/* 회원탈퇴 모달 */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <h3 className="text-base font-semibold mb-1">회원 탈퇴</h3>
            <p className="text-sm text-muted-foreground mb-4">탈퇴 후 모든 데이터가 삭제됩니다. 비밀번호를 입력해 확인해주세요.</p>
            {deleteError && <p className="text-destructive text-xs mb-3 p-2 bg-destructive/10 rounded">{deleteError}</p>}
            <input
              type="password" value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)}
              placeholder="비밀번호 입력"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-destructive mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShowDeleteModal(false); setDeletePassword(''); setDeleteError('') }}
                className="flex-1 px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent/50 transition-colors">
                취소
              </button>
              <button onClick={handleDeleteAccount} disabled={deleting}
                className="flex-1 px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50">
                {deleting ? '처리 중...' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
