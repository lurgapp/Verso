import { NextResponse, type NextRequest } from 'next/server';
import { VIDEO_FRAME_ORIGINS } from './lib/media-url';
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const development = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' https: data: blob:",
    `frame-src ${VIDEO_FRAME_ORIGINS.join(' ')}`, "media-src 'self' https: blob:",
    "font-src 'self'", `connect-src 'self'${development ? ' ws: wss:' : ''}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({request:{headers}});
  response.headers.set('Content-Security-Policy', csp);
  return response;
}
export const config = {matcher:['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|fonts).*)']};
