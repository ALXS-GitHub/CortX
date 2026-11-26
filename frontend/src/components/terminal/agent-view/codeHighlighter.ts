/**
 * Syntax highlighting of the code blocks in the agent view (CORT-66), as the
 * Claude desktop app does. A Streamdown code plugin built on Shiki's core:
 * the JavaScript regex engine (no wasm) and one chunk per language, loaded
 * the first time a block in that language shows — the bundle does not carry
 * a hundred grammars nobody reads. An unknown language stays plain text.
 */
import type { CodeHighlighterPlugin, HighlightOptions } from 'streamdown';
import type { HighlighterCore, LanguageRegistration } from 'shiki/core';

/** What a highlight gives Streamdown (its type is not exported). */
type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin['highlight']>>;

type LangModule = { default: LanguageRegistration[] };

const LANGS: Record<string, () => Promise<LangModule>> = {
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  jsonc: () => import('shiki/dist/langs/jsonc.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  shellscript: () => import('shiki/dist/langs/shellscript.mjs'),
  powershell: () => import('shiki/dist/langs/powershell.mjs'),
  bat: () => import('shiki/dist/langs/bat.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  scss: () => import('shiki/dist/langs/scss.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  xml: () => import('shiki/dist/langs/xml.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
  toml: () => import('shiki/dist/langs/toml.mjs'),
  ini: () => import('shiki/dist/langs/ini.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  diff: () => import('shiki/dist/langs/diff.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  c: () => import('shiki/dist/langs/c.mjs'),
  cpp: () => import('shiki/dist/langs/cpp.mjs'),
  csharp: () => import('shiki/dist/langs/csharp.mjs'),
  java: () => import('shiki/dist/langs/java.mjs'),
  kotlin: () => import('shiki/dist/langs/kotlin.mjs'),
  swift: () => import('shiki/dist/langs/swift.mjs'),
  php: () => import('shiki/dist/langs/php.mjs'),
  ruby: () => import('shiki/dist/langs/ruby.mjs'),
  lua: () => import('shiki/dist/langs/lua.mjs'),
  dockerfile: () => import('shiki/dist/langs/dockerfile.mjs'),
  graphql: () => import('shiki/dist/langs/graphql.mjs'),
  vue: () => import('shiki/dist/langs/vue.mjs'),
  svelte: () => import('shiki/dist/langs/svelte.mjs'),
};

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json5: 'jsonc',
  rs: 'rust',
  py: 'python',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  console: 'shellscript',
  ps1: 'powershell',
  ps: 'powershell',
  pwsh: 'powershell',
  cmd: 'bat',
  batch: 'bat',
  htm: 'html',
  svg: 'xml',
  md: 'markdown',
  yml: 'yaml',
  patch: 'diff',
  golang: 'go',
  'c++': 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  kt: 'kotlin',
  rb: 'ruby',
  docker: 'dockerfile',
  gql: 'graphql',
};

const THEMES: [string, string] = ['github-light', 'github-dark'];

function langOf(language: string): string | null {
  const id = language.trim().toLowerCase();
  const name = ALIASES[id] ?? id;
  return name in LANGS ? name : null;
}

let core: Promise<HighlighterCore> | null = null;

function highlighter(): Promise<HighlighterCore> {
  core ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [import('shiki/dist/themes/github-light.mjs'), import('shiki/dist/themes/github-dark.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  );
  return core;
}

const loading = new Map<string, Promise<void>>();

function ensureLang(hl: HighlighterCore, lang: string): Promise<void> {
  if (hl.getLoadedLanguages().includes(lang)) return Promise.resolve();
  let pending = loading.get(lang);
  if (!pending) {
    pending = LANGS[lang]().then((mod) => hl.loadLanguage(...mod.default));
    pending.catch(() => loading.delete(lang));
    loading.set(lang, pending);
  }
  return pending;
}

/** Recently highlighted blocks: a re-render (a new message below) costs nothing. */
const cache = new Map<string, HighlightResult>();
const CACHE_SIZE = 200;

function remember(key: string, result: HighlightResult) {
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

function tokenize(hl: HighlighterCore, code: string, lang: string): HighlightResult {
  const result = hl.codeToTokens(code, { lang, themes: { light: THEMES[0], dark: THEMES[1] } });
  return { tokens: result.tokens, bg: 'transparent', fg: 'inherit' } as HighlightResult;
}

export const codeHighlighter: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => [...Object.keys(LANGS), ...Object.keys(ALIASES)],
  getThemes: () => THEMES,
  supportsLanguage: (language) => langOf(language) !== null,
  highlight({ code, language }: HighlightOptions, callback?: (result: HighlightResult) => void): HighlightResult | null {
    const lang = langOf(language);
    if (!lang) return null;
    const key = `${lang}\u0000${code}`;
    const hit = cache.get(key);
    if (hit) return hit;
    void highlighter()
      .then(async (hl) => {
        await ensureLang(hl, lang);
        const result = tokenize(hl, code, lang);
        remember(key, result);
        callback?.(result);
      })
      .catch(() => {
        /* stays plain text */
      });
    return null;
  },
};
