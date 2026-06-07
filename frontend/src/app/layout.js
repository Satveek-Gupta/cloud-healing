import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import TopBar   from '@/components/TopBar';
import { RealtimeProvider } from '@/context/RealtimeContext';


export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title:       'SelfHeal — AI-Powered Self-Healing Infrastructure',
  description: 'Monitor. Intelligently. Heal. Automatically. SelfHeal is an AI-powered cloud infrastructure platform that detects failures and self-heals in real time.',
  keywords:    'self-healing, infrastructure, monitoring, AI, cloud, DevOps, SRE',
  authors:     [{ name: 'SelfHeal' }],
  openGraph: {
    title:       'SelfHeal — AI-Powered Self-Healing Infrastructure',
    description: 'Monitor. Intelligently. Heal. Automatically.',
    images:      [{ url: '/SelfHeal_Horizontal.png', width: 1536, height: 512 }],
    type:        'website',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'SelfHeal',
    description: 'AI-powered self-healing cloud infrastructure.',
    images:      ['/SelfHeal_Horizontal.png'],
  },
  icons: {
    icon:        '/favicon.png',
    shortcut:    '/favicon.png',
    apple:       '/SelfHeal_Emblem.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;1,14..32,400&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        </head>
        <body>
          <RealtimeProvider>
            <div className="shell">
              <TopBar />
              <main className="page-content">
                {children}
              </main>
            </div>
          </RealtimeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
