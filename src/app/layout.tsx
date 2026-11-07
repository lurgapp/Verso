import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { PreferencesProvider } from '@/components/preferences';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/cyrillic-700.css';
import './globals.css';
import 'katex/dist/katex.min.css';
import './advanced-blocks.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:3000'),
  title: {default:'Verso — Write. Publish. Share.',template:'%s · Verso'},
  description:'A quiet space for your words. Write and publish beautifully, without an account.',
  robots: {index:true,follow:true},
};
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:[{media:'(prefers-color-scheme: light)',color:'#ffffff'},{media:'(prefers-color-scheme: dark)',color:'#111111'}]};
export default async function RootLayout({children}:{children:React.ReactNode}) {
  const nonce=(await headers()).get('x-nonce') || undefined;
  return <html lang="en" suppressHydrationWarning><head>
    <script nonce={nonce} dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem('verso-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var l=localStorage.getItem('verso-language');document.documentElement.lang=l==='ru'||l==='en'?l:navigator.language.startsWith('ru')?'ru':'en'}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}`}}/>
  </head><body><PreferencesProvider>{children}</PreferencesProvider></body></html>;
}
