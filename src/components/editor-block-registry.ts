import type { Editor } from '@tiptap/react';
import { Heading, Quote, List, ListOrdered, ListTodo, Table2, Minus, Braces, Camera, Film, Sigma, Workflow, Info, ChevronsUpDown, ListTree, Superscript, Images, Link2, type LucideIcon } from 'lucide-react';
export type BlockCommand = { id: string; en: string; ru: string; section: 'headings' | 'lists' | 'blocks' | 'media'; icon: LucideIcon; keywords: string; run: (editor: Editor, dialog: (name: string) => void) => void };
const headingCommands: BlockCommand[] = ([1, 2, 3, 4, 5, 6] as const).map(level => ({ id: `h${level}`, en: `Heading ${level}`, ru: `Заголовок ${level}`, section: 'headings', icon: Heading, keywords: `h${level} заголовок heading`, run: editor => { editor.chain().focus().setHeading({ level }).run(); } }));
export const BLOCK_COMMANDS: BlockCommand[] = [...headingCommands,
  { id: 'bullet', en: 'Bullet list', ru: 'Маркированный список', section: 'lists', icon: List, keywords: 'list bullet список', run: e => { e.chain().focus().toggleBulletList().run(); } },
  { id: 'ordered', en: 'Ordered list', ru: 'Нумерованный список', section: 'lists', icon: ListOrdered, keywords: 'list ordered список', run: e => { e.chain().focus().toggleOrderedList().run(); } },
  { id: 'task', en: 'Task list', ru: 'Список задач', section: 'lists', icon: ListTodo, keywords: 'todo task checklist задачи список', run: e => { e.chain().focus().toggleTaskList().run(); } },
  { id: 'table', en: 'Insert 3 × 3 table', ru: 'Таблица 3 × 3', section: 'blocks', icon: Table2, keywords: 'table таблица', run: e => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  { id: 'csv', en: 'Import CSV', ru: 'Импорт CSV', section: 'blocks', icon: Table2, keywords: 'csv spreadsheet excel таблица импорт', run: (_e, dialog) => dialog('csv') },
  { id: 'code', en: 'Code block', ru: 'Блок кода', section: 'blocks', icon: Braces, keywords: 'code код', run: e => { e.chain().focus().toggleCodeBlock().run(); } },
  { id: 'quote', en: 'Blockquote', ru: 'Цитата', section: 'blocks', icon: Quote, keywords: 'quote цитата', run: e => { e.chain().focus().toggleBlockquote().run(); } },
  { id: 'divider', en: 'Horizontal rule', ru: 'Разделитель', section: 'blocks', icon: Minus, keywords: 'divider line разделитель', run: e => { e.chain().focus().setHorizontalRule().run(); } },
  { id: 'math', en: 'Formula', ru: 'Формула', section: 'blocks', icon: Sigma, keywords: 'math latex formula формула', run: (_e, dialog) => dialog('math') },
  { id: 'mermaid', en: 'Diagram', ru: 'Диаграмма', section: 'blocks', icon: Workflow, keywords: 'mermaid diagram диаграмма схема', run: (_e, dialog) => dialog('mermaid') },
  { id: 'callout', en: 'Callout', ru: 'Информационный блок', section: 'blocks', icon: Info, keywords: 'callout note warning заметка блок', run: e => { e.chain().focus().insertContent({ type: 'callout', attrs: { kind: 'info', title: 'Info' }, content: [{ type: 'paragraph' }] }).run(); } },
  { id: 'toggle', en: 'Collapsible block', ru: 'Раскрывающийся блок', section: 'blocks', icon: ChevronsUpDown, keywords: 'toggle collapse details блок', run: e => { e.chain().focus().insertContent({ type: 'toggle', attrs: { title: 'Details', open: true }, content: [{ type: 'paragraph' }] }).run(); } },
  { id: 'toc', en: 'Table of contents', ru: 'Оглавление', section: 'blocks', icon: ListTree, keywords: 'toc contents оглавление', run: e => { e.chain().focus().insertContent([{ type: 'tableOfContents' }, { type: 'paragraph' }]).run(); } },
  { id: 'footnote', en: 'Footnote', ru: 'Сноска', section: 'blocks', icon: Superscript, keywords: 'footnote сноска', run: (_e, dialog) => dialog('footnote') },
  { id: 'image', en: 'Insert image', ru: 'Вставить изображение', section: 'media', icon: Camera, keywords: 'image photo picture изображение фото', run: (_e, dialog) => dialog('image') },
  { id: 'video', en: 'Insert video', ru: 'Вставить видео', section: 'media', icon: Film, keywords: 'video видео', run: (_e, dialog) => dialog('video') },
  { id: 'gallery', en: 'Image gallery', ru: 'Галерея изображений', section: 'media', icon: Images, keywords: 'gallery images галерея', run: (_e, dialog) => dialog('gallery') },
  { id: 'preview', en: 'Link preview', ru: 'Карточка ссылки', section: 'media', icon: Link2, keywords: 'preview link карточка ссылка', run: (_e, dialog) => dialog('preview') },
];
export function filterBlockCommands(query: string) { const value = query.trim().toLowerCase(); return BLOCK_COMMANDS.filter(command => `${command.id} ${command.en} ${command.ru} ${command.keywords}`.toLowerCase().includes(value)); }
