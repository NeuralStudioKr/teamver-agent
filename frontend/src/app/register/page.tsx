'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { token } = await api.register(name, email, password)
      localStorage.setItem('ta_token', token)
      router.push('/workspace')
    } catch (e: any) {
      setError(e.message || '회원가입 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md px-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/20 mb-4">
            <span className="text-2xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Teamver Agent</h1>
          <p className="text-muted-foreground mt-1">AI 팀원과 함께하는 협업 플랫폼</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-8">
          <h2 className="text-lg font-semibold mb-6">회원가입</h2>
          {error && <p className="text-destructive text-sm mb-4 p-3 bg-destructive/10 rounded-lg">{error}</p>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-1.5">이름</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required
                className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                placeholder="홍길동" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1.5">이메일</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                placeholder="name@company.com" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1.5">비밀번호</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1.5">비밀번호 확인</label>
              <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} required
                className={`w-full bg-secondary border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm ${
                  passwordConfirm && password !== passwordConfirm ? 'border-destructive' : 'border-border'
                }`}
                placeholder="••••••••" />
              {passwordConfirm && password !== passwordConfirm && (
                <p className="text-destructive text-xs mt-1">비밀번호가 일치하지 않습니다.</p>
              )}
              {passwordConfirm && password === passwordConfirm && (
                <p className="text-green-500 text-xs mt-1">✓ 비밀번호가 일치합니다.</p>
              )}
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {loading ? '가입 중...' : '시작하기'}
            </button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-6">
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className="text-primary hover:underline">로그인</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
