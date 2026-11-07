import { notFound } from 'next/navigation';
import { getPublicArticle } from '@/lib/server/articles';
import { EditorPage } from '@/components/editor-page';
export const dynamic='force-dynamic';
export const metadata={title:'Edit your story',robots:{index:false,follow:false}};
export default async function EditArticle({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const article=await getPublicArticle(id); if(!article) notFound();
  return <EditorPage article={article} lurgUrl={process.env.LURG_URL || 'https://lurg.pro'}/>;
}
