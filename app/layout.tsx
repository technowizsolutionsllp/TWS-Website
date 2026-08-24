import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://technowiz-solutions.sites.openai.com'),
  title: 'Technowiz Solutions | Local-first software products',
  description:
    'Technowiz Solutions develops, designs, markets, licenses, and supports focused digital software products, applications, ITES, consulting, and support services.',
  openGraph: {
    title: 'Technowiz Solutions',
    description: 'Local-first software for high-trust file work.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Technowiz Solutions',
    description: 'Local-first software for high-trust file work.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
