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
      // The PinchPDF trial notice and terms are now part of the privacy policy (Annex A) and the
      // terms (Part B, Schedule A). The app links to these old addresses, so they stay (not permanent).
      { source: '/pinchpdf/legal/privacy', destination: '/privacy#pinchpdf-trial', permanent: false },
      { source: '/pinchpdf/legal/privacy/:version', destination: '/privacy#pinchpdf-trial', permanent: false },
      { source: '/pinchpdf/legal/trial-terms', destination: '/terms#schedule-a-trial', permanent: false },
      { source: '/pinchpdf/legal/trial-terms/:version', destination: '/terms#schedule-a-trial', permanent: false },
    ];
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
