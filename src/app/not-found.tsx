import Link from 'next/link';
import { Header, Footer } from '@/components/chrome';
export default function NotFound(){return <div className="app-shell"><Header/><main className="article-main"><h1 className="article-title">Story not found.</h1><p>This link may be incorrect, or the story was removed.</p><Link className="primary-button" href="/">Write a story</Link></main><Footer lurgUrl="https://lurg.pro"/></div>;}
