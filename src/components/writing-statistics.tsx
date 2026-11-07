'use client';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { EditorDocument } from '@/lib/types';
import { textStatistics, type WritingStatistics } from '@/lib/writing-stats';
import { usePreferences } from './preferences';
import { Dialog } from './ui';
import './writing-tools.css';

export function WritingStatisticsControl({editor}:{editor:Editor}) {
  const {language}=usePreferences();const ru=language==='ru';const [stats,setStats]=useState<WritingStatistics>(()=>textStatistics(editor.getJSON() as EditorDocument,language));const [open,setOpen]=useState(false);const [goal,setGoal]=useState({kind:'words',target:0});
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('verso-writing-goal')??'null');if(saved&&['words','characters'].includes(saved.kind)&&Number.isInteger(saved.target)&&saved.target>=0&&saved.target<=1_000_000)setGoal(saved);}catch{}},[]);
  useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const update=()=>{clearTimeout(timer);timer=setTimeout(()=>setStats(textStatistics(editor.getJSON() as EditorDocument,language)),400);};editor.on('update',update);update();return()=>{clearTimeout(timer);editor.off('update',update);};},[editor,language]);
  function updateGoal(next:typeof goal){setGoal(next);try{localStorage.setItem('verso-writing-goal',JSON.stringify(next));}catch{}}
  const labels:Record<keyof WritingStatistics,string>={words:ru?'Слова':'Words',characters:ru?'Символы':'Characters',charactersWithoutSpaces:ru?'Символы без пробелов':'Characters without spaces',paragraphs:ru?'Абзацы':'Paragraphs',sentences:ru?'Предложения':'Sentences',readingMinutes:ru?'Минуты чтения':'Reading minutes',headings:ru?'Заголовки':'Headings',links:ru?'Ссылки':'Links'};
  return <><button type="button" className="word-count text-button statistics-trigger" onClick={()=>setOpen(true)} aria-label={ru?'Статистика текста':'Text statistics'}>{goal.target>0?`${stats[goal.kind as 'words'|'characters'].toLocaleString(language)} / ${goal.target.toLocaleString(language)} ${goal.kind==='words'?(ru?'слов':'words'):(ru?'симв.':'chars')}`:`${stats.words.toLocaleString(language)} ${ru?'слов':stats.words===1?'word':'words'}`}<span aria-hidden="true"> · </span>{stats.readingMinutes} {ru?'мин чтения':'min read'}</button>{open&&<Dialog title={ru?'Статистика текста':'Text statistics'} onClose={()=>setOpen(false)}><dl className="writing-statistics">{Object.entries(stats).map(([key,value])=><div key={key}><dt>{labels[key as keyof WritingStatistics]}</dt><dd>{value.toLocaleString(language)}</dd></div>)}</dl><fieldset className="writing-goal"><legend>{ru?'Цель написания (необязательно)':'Writing goal (optional)'}</legend><label className="form-label">{ru?'Считать':'Count'}<select value={goal.kind} aria-label={ru?'Единица цели':'Goal unit'} onChange={event=>updateGoal({...goal,kind:event.target.value})}><option value="words">{ru?'Слова':'Words'}</option><option value="characters">{ru?'Символы':'Characters'}</option></select></label><label className="form-label">{ru?'Целевое количество · 0 выключает цель':'Target · 0 disables the goal'}<input type="number" min={0} max={1_000_000} step={1} value={goal.target} aria-label={ru?'Целевое количество':'Writing target'} onChange={event=>updateGoal({...goal,target:Math.min(1_000_000,Math.max(0,Math.floor(Number(event.target.value)||0)))})}/></label>{goal.target>0&&<progress max={goal.target} value={stats[goal.kind as 'words'|'characters']} aria-label={ru?'Прогресс написания':'Writing progress'}/>}</fieldset></Dialog>}</>;
}

