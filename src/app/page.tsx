import { EditorPage } from '@/components/editor-page';
export const dynamic='force-dynamic';
export default function Home() {return <EditorPage lurgUrl={process.env.LURG_URL || 'https://lurg.pro'}/>;}
