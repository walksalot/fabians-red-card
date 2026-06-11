import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Fabian's Red Card — World Cup Pool",
  description:
    'Private World Cup 2026 prediction pool — exact scores, first goalscorers, boosters and bragging rights.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#09090b',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-dvh bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
