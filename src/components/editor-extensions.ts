import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Mark } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { AnimatedImage } from './image-extension';
import { Video } from './video-extension';
import { ADVANCED_NODE_EXTENSIONS } from './editor-advanced-extensions';
import { SmartPaste, shouldAutoLink } from './editor-transforms';
import { FindReplaceExtension } from './find-replace-extension';
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'gray'] as const;
export const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'] as const;
const NamedHighlight = Highlight.extend({
  addAttributes: () => ({ color: { default: 'yellow', parseHTML: element => element.getAttribute('data-highlight') ?? 'yellow', renderHTML: attrs => ({ 'data-highlight': HIGHLIGHT_COLORS.includes(attrs.color) ? attrs.color : 'yellow', class: `highlight-${HIGHLIGHT_COLORS.includes(attrs.color) ? attrs.color : 'yellow'}` }) } }),
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
  renderMarkdown: (node, h) => `<mark data-highlight="${HIGHLIGHT_COLORS.includes(node.attrs?.color) ? node.attrs?.color : 'yellow'}">${h.renderChildren(node)}</mark>`,
});
const NamedTextStyle = Mark.create({ name: 'textStyle', addAttributes: () => ({ color: { default: null, parseHTML: element => element.getAttribute('data-color'), renderHTML: attrs => TEXT_COLORS.includes(attrs.color) ? { 'data-color': attrs.color, class: `text-${attrs.color}` } : {} } }), parseHTML: () => [{ tag: 'span[data-color]' }], renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0], renderMarkdown: (node, h) => `<span data-color="${TEXT_COLORS.includes(node.attrs?.color) ? node.attrs?.color : 'gray'}">${h.renderChildren(node)}</span>` });
/** Shared schema used by the editor and schema round-trip tests. */
export function createEditorExtensions() { return [StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true, shouldAutoLink, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow' } } }), Markdown, AnimatedImage.configure({ allowBase64: false, HTMLAttributes: { loading: 'lazy' } }), Video, TableKit.configure({ table: { resizable: true, cellMinWidth: 60, renderWrapper: true } }), TaskList, TaskItem.configure({ nested: true }), NamedHighlight.configure({ multicolor: true }), NamedTextStyle, Subscript, Superscript, TextAlign.configure({ types: ['heading', 'paragraph', 'tableCell', 'tableHeader'] }), ...ADVANCED_NODE_EXTENSIONS, SmartPaste, FindReplaceExtension]; }
