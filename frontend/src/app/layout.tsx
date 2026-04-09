import type { Metadata } from 'next'
import { Inter, Noto_Sans_KR } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const notoSansKR = Noto_Sans_KR({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-noto' })

export const metadata: Metadata = {
  title: 'Teamver Agent',
  description: 'AI-powered team collaboration platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className={`${inter.variable} ${notoSansKR.variable} font-sans`} style={{ fontFamily: 'var(--font-noto), var(--font-inter), sans-serif' }}>{children}</body>
    </html>
  )
}
