import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Technowiz Solutions',
    short_name: 'Technowiz',
    description:
      'Product-led software, workflow systems, automation, desktop utilities, and IT-enabled operations.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#102033',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
