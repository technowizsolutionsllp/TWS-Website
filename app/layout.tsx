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
  applicationName: 'Technowiz Solutions',
  title: {
    default: 'Technowiz Solutions | Product-led software and workflow systems',
    template: '%s | Technowiz Solutions',
  },
  description:
    'Technowiz Solutions builds software products, workflow systems, automation, desktop utilities, and IT-enabled operations for businesses that need clarity, control, and speed.',
  keywords: [
    'Technowiz Solutions',
    'software product development',
    'desktop software development',
    'Windows desktop utilities',
    'workflow automation software',
    'duplicate file cleaner',
    'PDF compressor',
    'IT enabled services',
    'custom software development',
  ],
  authors: [{ name: 'Technowiz Solutions' }],
  creator: 'Technowiz Solutions',
  publisher: 'Technowiz Solutions',
  category: 'Software development',
  alternates: {
    canonical: '/',
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.svg',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    title: 'Technowiz Solutions | Product-led software and workflow systems',
    description:
      'Software products, workflow systems, automation, desktop utilities, and IT-enabled operations for businesses that need clarity, control, and speed.',
    url: '/',
    siteName: 'Technowiz Solutions',
    images: ['/og.png'],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Technowiz Solutions | Product-led software and workflow systems',
    description:
      'Software products, workflow systems, automation, desktop utilities, and IT-enabled operations for businesses that need clarity, control, and speed.',
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
