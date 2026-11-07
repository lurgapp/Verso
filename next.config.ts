import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone', poweredByHeader: false,
  // Media is validated and resized by Verso; the unused optimizer adds an input surface.
  images: { unoptimized: true },
  experimental: { cpus: 2 },
  async headers() { return [{source:'/:path*', headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
    {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
  ]}]; },
};
export default nextConfig;
