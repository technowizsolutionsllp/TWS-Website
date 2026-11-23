import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  experimental: {
    // vinext applies this limit (default 1 MB) to every multipart POST, including
    // the /api/get-support route handler. It must exceed the 20 MB attachment cap
    // plus form overhead; the route enforces the real limit itself.
    serverActions: { bodySizeLimit: '22mb' },
  },
  async redirects() {
    return [
      { source: '/pdf-compressor', destination: '/pinchpdf', permanent: true },
      { source: '/products/pdf-compressor', destination: '/pinchpdf', permanent: true },
      // /license was an early draft address: the license agreement is Part B of /terms.
      { source: '/license', destination: '/terms#software-license', permanent: false },
    ];
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
