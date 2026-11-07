# Verso Editor 2.0: возможности и границы

Документ описывает возможности исходного кода и их ограничения. Команды проверок приведены в [verification](verification.md).

Редактор сохраняет минимальную основную поверхность: форматирование появляется при выделении текста, вставка открывается через отдельный плюс в левом поле или `/`, расширенные настройки находятся в меню. Регистрация, социальные реакции, комментарии и рекламная аналитика не добавлены.

## Матрица возможностей

| Возможность | Реализация | Существенные границы |
| --- | --- | --- |
| Форматирование | Bold, italic, underline, strike, inline code, ссылки, subscript/superscript, H1–H6, цитаты, выравнивание, пять highlight и восемь text colors | Палитры именованные; произвольные CSS-цвета сервер не принимает |
| Floating toolbar | BubbleMenu только при непустом текстовом выделении; основные кнопки и меню дополнительного форматирования; сохранение выделения при действиях | Положение учитывает viewport и доступное место; поведение системных touch handles зависит от браузера |
| Slash commands | `/` в начале абзаца, поиск на русском/английском, ↑/↓, Enter, Escape; общий `BLOCK_COMMANDS` с меню плюса | Поиск по подстроке названий/ключевых слов, не fuzzy search; максимум 40 символов запроса |
| Перемещение блоков | Drag handle, линия вставки, прокрутка при dragover у края, Undo; Alt+Shift+↑/↓ и кнопки перемещения | Перемещается **целый блок верхнего уровня** вместе с вложенным содержимым. Перестройка вложенных списков произвольным drag не заявляется; на мобильном есть long press и кнопки ↑/↓ |
| Smart paste | Restricted HTML сохраняет основные заголовки, списки, ссылки, таблицы, цитаты и code; Markdown; plain paste; изображения через upload | Нет отдельных парсеров каждого бренда Word/Docs/Notion/ChatGPT/GitHub и гарантии полного сохранения их служебных стилей. HTML+text clipboard ограничены суммарно 500 000 символами |
| Таблицы | Resize столбцов, добавить/удалить строки и столбцы, merge/split, header row, выравнивание, копирование ячеек, TSV paste, CSV import, явная сортировка выбранного столбца | CSV/TSV parser: до 200 строк × 30 столбцов; CSV-файл до 500 KB. Сортировка сохраняет первую строку заголовков и отказывается от таблиц с объединёнными ячейками |
| Код | Lazy Shiki, живые decorations, выбор языка, filename, номера строк, copy, wrap/scroll, отдельный preview, light/dark | Highlight до 60 000 символов на блок; большие блоки остаются обычным редактируемым текстом. Detect language распознаёт JSON, HTML и несколько shebang, иначе выбирает plaintext; универсальный классификатор не заявляется |
| Формулы | Inline `$…$`, block `$$…$$`, диалог и редактирование LaTeX, preview/error, copy, нумерация block-формул и ссылки `#eq-…` | До 4000 символов на формулу; KaTeX `trust:false`, strict errors, ограниченные expansion/size. Поддерживается синтаксис KaTeX, не полный TeX |
| Mermaid | Исходник/preview, редактирование, light/dark, zoom, copy, SVG/PNG download | До 20 000 символов и 500 edges; strict mode. Config directives, custom styles и external actions отключены; SVG дополнительно очищается. Неподдерживаемый/ошибочный исходник остаётся текстом с ошибкой |
| Сноски | Inline reference, редактирование/удаление, производные номера, reader backlinks, Markdown definitions | Текст объяснения до 4000 символов. Повторный ID на сервере разрешён только с тем же объяснением |
| Оглавление | Живое оглавление H1–H6, стабильные heading ID, вложенное reader-оглавление, переходы, активный раздел, копирование ссылки на раздел | В редакторе уровни показаны отступами; во внешних экспортах интерактивное отслеживание прокрутки не требуется |
| Callouts | Info/note/tip/warning/important, редактируемые title/body; сдержанные цвета, иконка в reader | Внутри поддерживаются обычные блоки; title ограничен канонической схемой |
| Collapsible | Title, раскрытие/закрытие, вложенные блоки; reader использует native details/summary | Начальное состояние хранится в документе; локальные reader-переключения не редактируют публикацию |
| Изображения | Файл/HTTPS URL/paste/drop, preview, upload progress/cancel, alt/caption, alignment, resize, static thumbnails, responsive reader, gallery/lightbox | Resize управляется ползунком ширины, не набором corner handles. UI галереи: до 20 файлов/URL, файлы суммарно до 32 MiB; каноническая схема допускает 30 image. Responsive descriptors используют настоящие intrinsic widths |
| Видео | YouTube/Vimeo/RuTube и прямые HTTPS media URL, MP4/WebM upload, preview, caption, aspect ratio, replace URL, error/fallback | Provider URLs нормализуются и allowlisted; доступность iframe зависит от внешнего сервиса. Приватные Vimeo/RuTube query links не поддерживаются; direct file query сохраняется |
| Focus | Скрывает второстепенный chrome; optional dim остальных абзацев; Escape выходит | Переключение локальное, содержание статьи не меняется |
| Typewriter | Центрирование текущей строки при обновлениях, visualViewport, пауза после ручного wheel/touch scroll | Пауза 1,5 секунды; не действует при открытом диалоге/неактивном editor. Системная клавиатура требует проверки на реальном устройстве |
| Typography | Sans/serif/mono, три размера, три line height, три ширины; light/dark/system | Editor и reader typography хранятся раздельно на устройстве; theme общая для приложения. Настройки не навязываются читателям публикации |
| Статистика | Intl.Segmenter RU/EN с Unicode fallback; слова, code-point символы, без пробелов, абзацы, предложения, reading time, headings, links | Пересчёт после 400 ms тишины; оценки зависят от сегментации. Части одной ссылки с разным форматированием считаются одной ссылкой |
| Цели | Локальная цель в словах или символах, простой прогресс | Target 0 выключает; нет streaks, наград или рейтингов |
| Поиск/замена | Ctrl/⌘+F/H, literal/case-sensitive, next/previous, replace one/all, decorations, Undo | Запрос до 500 символов, максимум 2000 совпадений. При лимите Replace all выключен с объяснением; поиск не пересекает абзацы и inline atoms |
| История | Bounded IndexedDB snapshots; owner-only publication history, preview, compare, restore новой версией при том же URL | Compare — два plain-text представления, не визуальный diff форматирования; restore использует полный canonical JSON. Точные retention bounds ниже |
| Import/export | MD/TXT/HTML import; MD/HTML/TXT/PDF export; validated canonical JSON сохраняет advanced blocks | Lossless round-trip использует документированное расширение Verso в Markdown comment/HTML meta, а не универсальный стандарт Markdown. PDF — browser print / Save as PDF; видео в PDF представлены ссылкой, не воспроизводятся |
| Smart links | HTTPS URL paste предлагает text link/card/plain; server metadata preview | SSRF-защита, DNS pinning, redirects/timeout/bytes limits; при отказе остаётся обычная ссылка. Preview не гарантируется для всех сайтов |
| Клавиши | Сочетания форматирования, поиск/замена, plain paste, publish/update, Undo/Redo, Escape; окно справки | Общие metadata/help и app-owned bindings используют `src/lib/shortcuts.ts`; стандартные editing bindings реализует TipTap |
| Microinteractions | Меню/плюс/focus/feedback используют короткие CSS transitions/animations, reduced-motion | Типичные CSS-переходы 150–200 ms; фоновые debounce нужны для тяжёлой обработки, а не для задержки ввода |
| Mobile | Responsive layout, scrollable tables/code, viewport-aware menus, safe-area spacing, touch alternatives для block move | Эмуляция мобильного viewport не доказывает работу всех виртуальных клавиатур/selection handles реальных iOS/Android |
| Accessibility | Keyboard controls, visible focus, labels, dialog focus handling, Escape, reduced motion, native details, keyboard lightbox | Цель — доступный интерфейс; полноценный независимый WCAG 2.2 AA аудит и сертификация не проводились. Screen-reader matrix и ручная проверка устройств остаются отдельными проверками |
| Performance | Lazy grammars/KaTeX/Mermaid, reader без TipTap, IntersectionObserver для тяжёлых reader blocks, debounce вычислений | Редактор не виртуализирован. Ограничения 500 000 символов/10 000 nodes/depth 32 остаются. Скорость 50 000 слов нельзя вывести только из лимитов; измерения конкретного запуска фиксируются отдельно |
| Security | Strict canonical validation, escaped/sanitized SSR/import/export, safe KaTeX/Mermaid, bounded media, CSP, quotas, owner ACL | Неизвестные узлы/marks/attrs отклоняются. Remote images/video грузит браузер; API не скачивает их произвольно |
| Schema/DB | Additive schemaVersion 1, optional attrs/new node types; additive Media/Article/ArticleVersion migrations; legacy reader compatibility | Новый parser читает старые статьи. **Старый строгий клиент не обязан понимать новые узлы**, поэтому additive v1 не означает двустороннюю совместимость любых клиентов; экспортируйте canonical JSON |
| Tests | Unit, isolated PostgreSQL integration, real media HTTP integration и Chromium E2E по группам ниже | Наличие теста в репозитории не равно успешному запуску в каждой среде. Production smoke и локальные прогоны описываются раздельно |

## Данные, медиа и безопасность

Canonical document ограничен 500 000 символов, 10 000 узлов и глубиной 32. Создание/PATCH статьи принимают JSON до 2 MiB; меньшие лимиты остальных endpoints не меняются. [API](api.md) описывает атрибуты, ошибки и URL контракт, включая настоящие `sourceWidth`/`thumbnailWidth`, которые независимы от display `width`.

GIF, Animated WebP и APNG сохраняют кадры/тайминг как Animated WebP со статичным poster. MP4/WebM демонстрации проходят bounded transcode. Есть сохранённая настройка playback system/paused/playing и reduced-motion; статичное превью не подменяет воспроизводимый оригинал. Потерянные кадры ранее сплющенных GIF нельзя восстановить без повторной загрузки оригинала. Подробные лимиты — [API: медиа](api.md#изображения-и-жалобы).

Link preview разрешает HTTPS/443, проверяет все DNS answers и каждый из максимум трёх redirects, закрепляет выбранный публичный IP, ограничивает HTML 256 KiB и общее время четырьмя секундами. Максимум два запроса одновременно на процесс, включая DNS/TLS; busy возвращает 503 с Retry-After. История требует существующий editing key, который не включается в документы/URL/HTML/Markdown exports.

Local snapshots: минимум 60 секунд между периодическими копиями, до 40 на draft, 200 суммарно, 30 дней, 12 MiB суммарно и 1 MB на snapshot. Основной draft сохраняется независимо от успеха history. Publication history: до 50 предыдущих версий, приблизительно 16 MiB на статью; snapshots старше 90 дней очищаются на успешном обновлении. Offline save работает у уже открытого редактора; service worker/offline navigation не добавлены. Детали — [writing tools](writing-tools.md).

## Клавиши

На macOS вместо Ctrl используется ⌘. Форматирование применяется внутри editor, а поисковые сочетания открывают поиск Verso при работе с документом.

| Сочетание | Действие |
| --- | --- |
| Ctrl/⌘+B, I, U | Bold, italic, underline |
| Ctrl/⌘+K | Диалог ссылки |
| Ctrl/⌘+Z / Ctrl/⌘+Shift+Z | Undo / redo |
| Ctrl/⌘+F / Ctrl/⌘+H | Find / replace |
| Ctrl/⌘+Shift+V | Вставка обычного текста |
| Ctrl/⌘+Enter | Publish / update |
| Alt+Shift+↑ / ↓ | Переместить текущий top-level block |
| `/`, затем ↑/↓ и Enter | Найти/выполнить block command |
| Escape | Закрыть меню/поиск/диалог либо выйти из focus |

Справка доступна через значок клавиатуры в footer. Slash и плюс используют `editor-block-registry.ts`. Реестр `src/lib/shortcuts.ts` задаёт metadata/help и matcher для app-owned сочетаний; стандартные marks/undo обрабатывает TipTap, перемещение блоков — SmartPaste.

## Карта реализации и проверок

Пути относительно корня репозитория. Перечень показывает назначение тестов, без утверждения об их запуске в production.

| Область | Основные исходники | Проверки |
| --- | --- | --- |
| Schema/SSR/palettes/anchors/math | `src/lib/document.ts`, `src/lib/server/render.ts`, `src/components/editor-extensions.ts`, `editor-advanced-extensions.tsx` | `tests/backend/document.test.ts`, `advanced-document.test.ts`, `article-body.test.ts`; `tests/e2e/editor-v2.spec.ts`, `advanced-reader.spec.ts` |
| Selection/slash/gutter/table/paste/move/shortcuts | `src/components/editor-toolbar.tsx`, `editor-block-registry.ts`, `editor-transforms.ts`, `editor-markdown.ts`, `src/lib/shortcuts.ts` | `tests/e2e/editor-v2.spec.ts`, `editor-ui.spec.ts`, `verso.spec.ts`; `tests/backend/shortcuts.test.ts` |
| Lazy code/math/Mermaid/reader/lightbox | `src/components/advanced-block-views.tsx`, `article-enhancements.tsx`, `src/lib/client/code-highlight.ts` | `tests/e2e/advanced-reader.spec.ts`; malicious source cases в backend advanced-document |
| Image/video/animation/thumbs | `src/components/image-extension.ts`, `video-extension.ts`, `controlled-media.tsx`, `src/lib/server/media*.ts`, `src/lib/media-url.ts` | `tests/backend/media.test.ts`, `media-video.test.ts`, `animated-document.test.ts`, `video.test.ts`; `tests/integration/media-http.test.ts`; `tests/e2e/animated-media.spec.ts` |
| Focus/typewriter/typography/stats/find | `src/components/writing-tools.tsx`, `reading-tools.tsx`, `writing-statistics.tsx`, `find-replace-extension.ts`, `src/lib/writing-stats.ts` | `tests/backend/writing-tools.test.ts`; `tests/e2e/writing-experience.spec.ts` |
| Local/server history/import/export | `src/lib/client/storage.ts`, `document-files.ts`, `document-export.ts`, `src/lib/server/articles.ts`, history API routes | `tests/integration/article-history.test.ts`; `tests/e2e/writing-experience.spec.ts`; export escaping в backend writing-tools |
| Safe link cards/OpenAPI | `src/lib/server/link-preview.ts`, link-preview route, `src/app/api/v1/openapi/route.ts` | `tests/backend/link-preview.test.ts`, `openapi.test.ts`; smart URL choices в editor-v2 E2E |
| Views/reading time/quotas | `src/lib/server/article-metrics.ts`, `src/lib/article-stats.ts`, article views route, `article-meta.tsx` | `tests/backend/article-stats.test.ts`, `article-visibility.test.ts`, `client-rate-limit.test.ts`; `tests/integration/article-metrics.test.ts`; `tests/e2e/article-metrics.spec.ts`, `publish-rate-limit.spec.ts` |

Для PostgreSQL integration tests обязательны явный `VERSO_ALLOW_ISOLATED_DB_TESTS=1` и разрешённая loopback database с тестовым именем; media HTTP integration отдельно требует разрешённый локальный URL. Browser publication tests запускаются на изолированном локальном сервере, чтобы не расходовать пользовательскую production-квоту. Команды проверок приведены в [verification](verification.md).

Анимация сохраняется при новых загрузках. Кадры, уже утраченные прежним статичным преобразованием файла, автоматически не восстанавливаются.
