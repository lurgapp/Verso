import type { HighlighterCore, LanguageRegistration } from 'shiki/core';

const languages: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  javascript: () => import('@shikijs/langs/javascript'), typescript: () => import('@shikijs/langs/typescript'), tsx: () => import('@shikijs/langs/tsx'), jsx: () => import('@shikijs/langs/jsx'),
  python: () => import('@shikijs/langs/python'), bash: () => import('@shikijs/langs/bash'), json: () => import('@shikijs/langs/json'), html: () => import('@shikijs/langs/html'), css: () => import('@shikijs/langs/css'),
  sql: () => import('@shikijs/langs/sql'), rust: () => import('@shikijs/langs/rust'), go: () => import('@shikijs/langs/go'), java: () => import('@shikijs/langs/java'), c: () => import('@shikijs/langs/c'), cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'), php: () => import('@shikijs/langs/php'), ruby: () => import('@shikijs/langs/ruby'), yaml: () => import('@shikijs/langs/yaml'), markdown: () => import('@shikijs/langs/markdown'), swift: () => import('@shikijs/langs/swift'), kotlin: () => import('@shikijs/langs/kotlin'), dockerfile: () => import('@shikijs/langs/dockerfile'), xml: () => import('@shikijs/langs/xml'), diff: () => import('@shikijs/langs/diff'),
};
const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', rs: 'rust', kt: 'kotlin', 'objective-c': 'c' };
let highlighter: Promise<HighlighterCore> | undefined;
const loading = new Map<string, Promise<void>>();
function getHighlighter() {
  return highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript'), import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')]).then(([core, engine, light, dark]) => core.createHighlighterCore({ themes: [light.default, dark.default], langs: [], engine: engine.createJavaScriptRegexEngine({ forgiving: true }) })).catch(error => { highlighter = undefined; throw error; });
}
async function prepared(requestedLanguage: string) {
  const language = (Object.hasOwn(aliases, requestedLanguage.toLowerCase()) ? aliases[requestedLanguage.toLowerCase()] : requestedLanguage.toLowerCase());
  const instance = await getHighlighter();
  if (Object.hasOwn(languages, language) && !instance.getLoadedLanguages().includes(language)) {
    let promise = loading.get(language);
    if (!promise) { promise = languages[language]().then(module => instance.loadLanguage(module.default)).catch(error => { loading.delete(language); throw error; }); loading.set(language, promise); }
    await promise;
  }
  return { instance, language: Object.hasOwn(languages, language) ? language : 'text' };
}
export async function highlightCode(code: string, requestedLanguage: string, dark = false): Promise<string> {
  if (code.length > 60000) return '';
  const { instance, language } = await prepared(requestedLanguage);
  return instance.codeToHtml(code, { lang: language, theme: dark ? 'github-dark' : 'github-light' });
}
export async function highlightCodeTokens(code: string, requestedLanguage: string, dark = false): Promise<Array<{ from: number; to: number; color: string }>> {
  if (code.length > 60000) return [];
  const { instance, language } = await prepared(requestedLanguage);
  return instance.codeToTokens(code, { lang: language, theme: dark ? 'github-dark' : 'github-light' }).tokens.flatMap(line => line.map(token => ({ from: token.offset, to: token.offset + token.content.length, color: token.color ?? (dark ? '#e6edf3' : '#24292f') })));
}

