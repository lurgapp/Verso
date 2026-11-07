'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Language = 'en' | 'ru';
type Theme = 'system' | 'light' | 'dark';
const russian: Record<string, string> = {
  'Choose a PNG, APNG, JPEG, GIF, WebP or AVIF image under 8 MB.': 'Выберите PNG, APNG, JPEG, GIF, WebP или AVIF размером до 8 МБ.',
  'Choose an MP4 or WebM video under 32 MB and 60 seconds.': 'Выберите MP4 или WebM размером до 32 МБ и длительностью до 60 секунд.',
  'Show view count': 'Показывать просмотры',
  'Underline':'Подчёркнутый', 'Find':'Поиск', 'Paste plain text':'Вставить обычный текст', 'Close menu / exit focus':'Закрыть меню / выйти из концентрации',
  'Publish': 'Опубликовать', 'Update': 'Обновить', 'Publishing…': 'Публикация…', 'Updating…': 'Обновление…',
  'Title': 'Заголовок', 'Tell your story…': 'Расскажите свою историю…', 'Copy link': 'Копировать ссылку',
  'Edit': 'Редактировать', 'New story': 'Новая статья', 'More actions': 'Другие действия',
  'Markdown is supported': 'Markdown поддерживается', 'Keyboard shortcuts': 'Горячие клавиши',
  'Close': 'Закрыть', 'Cancel': 'Отмена', 'Save': 'Сохранить', 'Delete article': 'Удалить статью',
  'Language': 'Язык', 'Theme': 'Тема', 'System': 'Системная', 'Light': 'Светлая', 'Dark': 'Тёмная',
  'Editing keys': 'Ключи редактирования', 'Export editing keys': 'Экспорт ключей', 'Import editing keys': 'Импорт ключей',
  'Export Markdown': 'Экспорт Markdown', 'Import Markdown': 'Импорт Markdown', 'Export draft': 'Скачать черновик',
  'Import draft': 'Импорт черновика', 'Clear draft': 'Очистить черновик', 'Saved on this device': 'Сохранено на устройстве',
  'Saving…': 'Сохранение…', 'Offline · saved on this device': 'Без сети · сохранено на устройстве',
  'Draft restored': 'Черновик восстановлен', 'Link copied': 'Ссылка скопирована', 'Published': 'Опубликовано',
  'Article updated': 'Статья обновлена', 'Insert image': 'Вставить изображение', 'Upload image': 'Загрузить изображение',
  'Image URL': 'URL изображения', 'Alternative text': 'Описание изображения', 'Insert': 'Вставить',
  'Add a link': 'Добавить ссылку', 'Link URL': 'URL ссылки', 'Remove link': 'Убрать ссылку',
  'Insert table': 'Вставить таблицу', 'Insert 3 × 3 table': 'Таблица 3 × 3', 'Add row': 'Добавить строку',
  'Delete row': 'Удалить строку', 'Add column': 'Добавить столбец', 'Delete column': 'Удалить столбец',
  'Delete table': 'Удалить таблицу', 'Headings': 'Заголовки', 'Paragraph': 'Обычный текст',
  'Bold': 'Жирный', 'Italic': 'Курсив', 'Strikethrough': 'Зачёркнутый', 'Inline code': 'Код в строке',
  'Bullet list': 'Маркированный список', 'Ordered list': 'Нумерованный список', 'Task list': 'Список задач',
  'Blockquote': 'Цитата', 'Code block': 'Блок кода', 'Horizontal rule': 'Разделитель', 'Undo': 'Отменить', 'Redo': 'Повторить',
  'Your editing keys are private. Anyone with a key can change or delete its article. Keep this file somewhere safe. Clearing browser data can remove your access.': 'Ключи редактирования конфиденциальны. С ключом можно изменить или удалить статью. Храните файл в безопасном месте. Очистка данных браузера может удалить доступ.',
  'No editing keys on this device yet.': 'На этом устройстве пока нет ключей редактирования.',
  'Editing keys imported': 'Ключи редактирования импортированы', 'Loading draft…': 'Загрузка черновика…',
  'Another tab changed this draft. Your text is safe here. Download your version before loading the saved draft.': 'Черновик изменён в другой вкладке. Ваш текст остаётся здесь. Скачайте свою версию перед загрузкой сохранённой.',
  'Download my draft': 'Скачать мою версию', 'Load saved draft': 'Загрузить сохранённый черновик',
  'This article changed since your draft was saved. Export your draft before loading the latest article.': 'Статья изменилась после сохранения черновика. Скачайте черновик перед загрузкой последней версии.',
  'Load latest article': 'Загрузить последнюю версию', 'Editing access unavailable': 'Нет доступа к редактированию',
  'The editing key is missing or invalid. Import your saved key to edit this article.': 'Ключ редактирования отсутствует или недействителен. Импортируйте сохранённый ключ, чтобы редактировать статью.',
  'View article': 'Посмотреть статью', 'This permanently removes the public article. A copy of your text will be downloaded first.': 'Публичная статья будет удалена. Сначала будет скачана копия вашего текста.',
  'Delete': 'Удалить', 'Report article': 'Пожаловаться', 'Report harmful or illegal content': 'Сообщить о вредоносном или незаконном содержимом',
  'Reason': 'Причина', 'Send report': 'Отправить жалобу', 'Report received': 'Жалоба принята',
  'Formatting while you write': 'Форматирование во время письма',
  'Type Markdown shortcuts directly in the editor. Paste Markdown or import a .md file to preserve formatting. Tables, images, lists and code stay in one document.': 'Введите Markdown прямо в редакторе. Вставьте Markdown или импортируйте файл .md, чтобы сохранить форматирование. Таблицы, изображения, списки и код остаются в одном документе.',
  'Publish or update': 'Публикация или обновление', 'Add link': 'Добавить ссылку',
  'Your browser could not save the editing key. Download it now to keep editing access.': 'Браузер не смог сохранить ключ. Скачайте его сейчас, чтобы сохранить доступ к редактированию.',
  'Download editing key': 'Скачать ключ редактирования', 'Open article': 'Открыть статью',
  'Draft imported': 'Черновик импортирован', 'Markdown imported': 'Markdown импортирован',
  'Replace draft?': 'Заменить черновик?', 'Your current draft will be downloaded before it is replaced.': 'Текущий черновик будет скачан перед заменой.',
  'Replace': 'Заменить', 'Upload or paste a secure image URL. Uploaded images are checked and optimized.': 'Загрузите изображение или вставьте безопасный URL. Загруженные изображения проверяются и оптимизируются.',
  'words': 'слов', 'word': 'слово', 'Checking editing access…': 'Проверка доступа…',
  'Insert block': 'Вставить блок', 'Insert blocks': 'Вставка блоков', 'Heading': 'Заголовок', 'Lists': 'Списки', 'Blocks': 'Блоки', 'Table actions': 'Действия с таблицей', 'Media': 'Медиа',
  'Image preview': 'Предпросмотр изображения', 'Loading preview…': 'Загрузка предпросмотра…', 'Image ready': 'Изображение готово', 'Uploading…': 'Загрузка…',
  'Use an HTTPS image URL.': 'Укажите прямую HTTPS-ссылку на изображение.',
  'Wait for a valid image preview before inserting.': 'Дождитесь загрузки предпросмотра изображения.',
  'This image could not be loaded. Use a direct image URL or upload a file.': 'Изображение не загрузилось. Укажите прямую ссылку на изображение или загрузите файл.',
  'The image took too long to load. Check the URL or upload a file.': 'Изображение не загрузилось вовремя. Проверьте ссылку или загрузите файл.',
  'Choose a PNG, JPEG, GIF, WebP or AVIF image under 8 MB.': 'Выберите изображение PNG, JPEG, GIF, WebP или AVIF размером до 8 МБ.',
  'Enter a valid HTTPS, HTTP or email link.': 'Укажите корректную HTTPS-, HTTP-ссылку или адрес электронной почты.', 'Invalid link.': 'Некорректная ссылка.', 'Upload failed.': 'Не удалось загрузить файл.',
  'Insert video': 'Вставить видео', 'Video URL': 'URL видео', 'Video ready': 'Видео готово',
  'Use a YouTube, Vimeo, RuTube or direct HTTPS video URL.': 'Укажите ссылку YouTube, Vimeo, RuTube или прямую HTTPS-ссылку на видеофайл.',
  'Paste a YouTube, Vimeo, RuTube or direct HTTPS video link. Video files can be linked; local uploads are for images.': 'Вставьте ссылку YouTube, Vimeo, RuTube или прямую HTTPS-ссылку на видеофайл. С устройства можно загружать изображения.',
  'This video could not be loaded. Check the direct file URL.': 'Видео не загрузилось. Проверьте прямую ссылку на файл.',
  'The video took too long to load. Check the direct file URL.': 'Видео не загрузилось вовремя. Проверьте прямую ссылку на файл.',
};

type Preferences = { language: Language; theme: Theme; setLanguage: (v: Language) => void; setTheme: (v: Theme) => void; t: (text: string) => string; toast: (text: string) => void };
const Context = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>('en');
  const [theme, updateTheme] = useState<Theme>('system');
  const [loaded, setLoaded] = useState(false);
  const [notification, setNotification] = useState('');
  useEffect(() => {
    try {
      const savedLanguage = localStorage.getItem('verso-language');
      updateLanguage(savedLanguage === 'ru' || savedLanguage === 'en' ? savedLanguage : navigator.language.startsWith('ru') ? 'ru' : 'en');
      const savedTheme = localStorage.getItem('verso-theme');
      updateTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system');
    } catch { /* Browser settings can disable preference storage. */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme; };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, loaded]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(''), 5000);
    return () => clearTimeout(timer);
  }, [notification]);
  const setLanguage = useCallback((v: Language) => { updateLanguage(v); try { localStorage.setItem('verso-language', v); } catch {} }, []);
  const setTheme = useCallback((v: Theme) => { updateTheme(v); try { localStorage.setItem('verso-theme', v); } catch {} }, []);
  const t = useCallback((text: string) => language === 'ru' ? russian[text] ?? text : text, [language]);
  const value = useMemo(() => ({ language, theme, setLanguage, setTheme, t, toast: setNotification }), [language, theme, setLanguage, setTheme, t]);
  return <Context.Provider value={value}>{children}<div className="toast" role="status" aria-live="polite" data-visible={!!notification}>{notification}</div></Context.Provider>;
}

export function usePreferences() {
  const context = useContext(Context);
  if (!context) throw new Error('Verso requires PreferencesProvider.');
  return context;
}
