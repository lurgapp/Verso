import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicArticle } from '@/lib/server/articles';
import { ArticleActions } from '@/components/article-actions';
import { ArticleEnhancements } from '@/components/article-enhancements';
import { ArticleMeta } from '@/components/article-meta';
import { MediaPlaybackEnhancer } from '@/components/controlled-media';
import { Footer } from '@/components/chrome';
import { documentText } from '@/lib/document';
import { cache } from 'react';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string}>};
const readArticle=cache(getPublicArticle);
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {id}=await params;
  const article=await readArticle(id);
  if(!article) return {title:'Story not found',robots:{index:false,follow:false}};
  return {
    title:article.title, description:documentText(article.content).slice(0,180),alternates:{canonical:`/a/${id}`},
    openGraph:{title:article.title,description:documentText(article.content).slice(0,180),url:`/a/${id}`,type:'article',siteName:'Verso',publishedTime:article.createdAt,modifiedTime:article.updatedAt,images:[{url:`/a/${id}/og?v=${article.version}`,width:1200,height:630,alt:article.title}]},
    twitter:{card:'summary_large_image',title:article.title,description:documentText(article.content).slice(0,180),images:[`/a/${id}/og?v=${article.version}`]},
  };
}
export default async function ArticlePage({params}:Props) {
  const {id}=await params;
  const article=await readArticle(id);
  if(!article) notFound();
  const lurgUrl=process.env.LURG_URL || 'https://lurg.pro';
  return <div className="app-shell"><ArticleActions article={article} lurgUrl={lurgUrl}/>
    <main className="article-main"><article aria-labelledby="article-title">
      <h1 id="article-title" className="article-title">{article.title}</h1>
      <ArticleMeta id={article.id} createdAt={article.createdAt} readingMinutes={article.readingMinutes} showViewCount={article.showViewCount} viewCount={article.viewCount}/>
      <div className="article-prose prose" dangerouslySetInnerHTML={{__html:article.html}}/>
      <MediaPlaybackEnhancer/><ArticleEnhancements/>
    </article></main><Footer lurgUrl={lurgUrl}/></div>;
}
