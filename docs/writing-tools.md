# Writing and reading tools

Writing preferences are stored only in the current browser. Editor and reader typography use separate keys (`verso-typography-editor`, `verso-typography-reader`); changing them does not change article JSON or another reader's typography. Font family, size, line height, page width and the existing light/dark/system theme are available from More actions. Focus mode hides secondary chrome and exits with Escape. Dimming other paragraphs is optional. Typewriter mode follows edits near the visible viewport center, respects reduced motion, and pauses after manual wheel/touch scrolling.

Text statistics update after a 400 ms quiet period and use `Intl.Segmenter` for Russian/English with a Unicode fallback. Contiguous fragments of one hyperlink count once even when their bold/italic marks differ. Words, code points, non-whitespace code points, paragraphs, sentences, reading minutes, headings and links are shown in the statistics dialog. A local word or character goal can be disabled by setting its target to zero.

The shared `src/lib/shortcuts.ts` registry supplies the help list and app-owned key matching, with Command displayed on Apple platforms and Ctrl elsewhere. TipTap retains its native standard formatting/undo bindings. Ctrl/Command+F opens editor search; Ctrl/Command+H also opens replacement. Literal, case-sensitive search supports nested blocks and text split across marks. Replacing all matches creates one undo transaction. At most 2,000 matches are decorated; when that limit is reached, the UI explicitly asks the author to refine the query and disables Replace all, avoiding a silent partial replacement. Search never crosses paragraph or inline atom boundaries.

## Local history

IndexedDB `verso-private` upgrades additively from version 1 to 2, keeping existing `drafts` and `ownership` stores and adding `snapshots`. A normal draft save first commits the live draft; optional history failure cannot prevent that save. Periodic snapshots have a minimum 60 second interval and avoid identical content. Import/restore/manual history actions preserve the current content first. Limits: 40 snapshots per draft, 200 total, 30 days, 12 MiB total and 1 MB per snapshot. Corrupt history entries are skipped and pruned on subsequent saves. Snapshot restoration does not falsely reset the current published-version conflict marker from a stale local base version.

An already open editor can save locally without a connection. This does not provide offline navigation or a service worker cache. Browsers can evict unpersisted local storage; export a copy and editing keys for independent backups.

## Publication history

History is visible only after proving article ownership with its existing editing key. The UI lists revisions, opens a snapshot, compares selected/current text and restores through the owner-authorized restore API. Restoring creates a new server version and preserves the article URL. It does not rewrite or remove the selected prior revision. Comparison is a side-by-side plain-text view. Full canonical JSON, including formatting and block attributes, is used when restoring; the comparison does not visualize formatting-only differences.

## Import and export

MD/Markdown, TXT and HTML imports are parsed locally and capped at 2 MB. Import never publishes a document. HTML is sanitized with a restricted tag/attribute/style list; scripts, handlers, arbitrary frames, SVG and MathML supplied by an imported file do not execute. A current local snapshot is saved before replacement.

Markdown uses ordinary headings, lists, links, images, code fences, math delimiters and standard footnotes where supported. Exported Markdown also includes an inert `verso-document:v2` base64 JSON comment. HTML includes the same canonical JSON in a `verso-document` meta tag. These documented extensions preserve attributes and advanced block structures on Verso re-import. The JSON is validated before use and contains article content and visibility settings, never editing keys. Plain text export intentionally removes formatting.

HTML and PDF rendering starts from validated canonical JSON, never by trusting supplied editor HTML. It escapes text/attributes, produces bounded KaTeX MathML with trust disabled, and reuses strict sanitized Mermaid SVG generation. HTML is a standalone file with static CSS and native MathML; formula rendering does not depend on external KaTeX fonts. Media URLs remain external references: exporting does not embed image binaries, download third-party files or create a self-contained media archive. Animation posters are used when available, with an explicit link to the original animation.

PDF uses the browser's native print dialog: choose Save as PDF. Before opening it, Verso prepares a dedicated print document, renders formulas/diagrams, waits for fonts and up to five seconds per image, and hides app controls. Headings, paragraphs, lists, tables, images, code, formula numbering, diagrams and footnotes are retained with page-break hints. Remote media still requires availability. PDF layout and content should be verified in the target browser.

