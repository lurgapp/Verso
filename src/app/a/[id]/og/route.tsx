import { ImageResponse } from 'next/og';
import { getPublicArticle } from '@/lib/server/articles';
import { rateLimit } from '@/lib/server/rate-limit';
import { errorResponse } from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try { await rateLimit(request,'og',30,60); } catch(error) { return errorResponse(error); }
  const {id}=await params; const article=await getPublicArticle(id);
  if(!article) return new Response('Not found',{status:404});
  return new ImageResponse(<div style={{width:'100%',height:'100%',background:'#fff',color:'#171717',padding:'68px 80px',display:'flex',flexDirection:'column',fontFamily:'sans-serif'}}>
    <div style={{fontSize:34,fontWeight:700,display:'flex'}}>verso<span style={{color:'#a3a3a3',marginLeft:8}}>·</span></div>
    <div style={{flex:1,display:'flex',alignItems:'center',fontSize:article.title.length>75?52:68,lineHeight:1.2,fontWeight:700,letterSpacing:'-2px'}}>{article.title.slice(0,180)}</div>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:22,color:'#737373',borderTop:'1px solid #eaeaea',paddingTop:24}}><span>Write. Publish. Share.</span><span>Made by Lurg</span></div>
  </div>,{width:1200,height:630,headers:{'Cache-Control':'public, max-age=300, s-maxage=300','X-Content-Type-Options':'nosniff'}});
}
