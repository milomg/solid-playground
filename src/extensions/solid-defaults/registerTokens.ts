// Wires our hand-rolled tokenizer (tokenizer.ts) into Monaco's tokens API for `typescriptreact`
// (the editor's primary language) plus `typescript` / `javascript` / `json` (so LSP-hover
// fenced code blocks pick up colors), using the encoded-tokens path. The legacy
// `setTokensProvider` form (returning IToken with a `scopes: string`) doesn't get translated
// to colors in the workbench setup — every scope ends up as the default `mtk1` class. Only
// the encoded form (Uint32Array of pre-resolved metadata) is honored.
//
// Encoding a token = looking up the scope chain against the theme's TM `tokenColors` rules
// (resolved scope → hex color → palette index) and packing into a 32-bit metadata word per
// Monaco's bit layout (see vs/editor/common/encodedTokenAttributes.d.ts). We don't use the
// theme's `getTokenStyleMetadata` because that only matches the semantic-token registry
// (`keyword`, `string`, …) and ignores TM scopes like `storage.type`.

import * as monaco from 'monaco-editor';
import { StandaloneServices, IWorkbenchThemeService } from '@codingame/monaco-vscode-api/services';
import tsxGrammarJson from './resources/TypeScriptReact.tmLanguage.json';
import jsonGrammarJson from './resources/JSON.tmLanguage.json';
import { Tokenizer, type RawGrammar, type TokenizerState } from './tokenizer';

class StateWrap implements monaco.languages.IState {
  constructor(public inner: TokenizerState) {}
  clone(): StateWrap {
    return new StateWrap(this.inner);
  }
  equals(other: monaco.languages.IState): boolean {
    if (!(other instanceof StateWrap)) return false;
    const a = this.inner.stack;
    const b = other.inner.stack;
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
}

// Bit layout (Monaco's MetadataConsts): 8 bits language, 2 bits token type, 1 bit balanced
// brackets, 4 bits font style (italic/bold/underline/strike), 9 bits foreground, 8 bits background.
const FONT_STYLE_ITALIC = 1 << 11;
const FONT_STYLE_BOLD = 1 << 12;
const FONT_STYLE_UNDERLINE = 1 << 13;
const FONT_STYLE_STRIKETHROUGH = 1 << 14;
const FOREGROUND_OFFSET = 15;

let registered = false;

export function registerLanguageTokens(): void {
  if (registered) return;
  registered = true;

  // The TypeScriptReact grammar is a strict superset of TS/JS syntax, so we reuse it for the
  // `typescript` and `javascript` language ids too. Scope names emitted carry the `.tsx`
  // suffix, which is fine — theme rules match on the leading segments and we strip dot
  // suffixes leftward when looking up rules.
  const tsxTokenizer = new Tokenizer(tsxGrammarJson as unknown as RawGrammar);
  const jsonTokenizer = new Tokenizer(jsonGrammarJson as unknown as RawGrammar);

  interface CompiledRule {
    selector: string; // last (most specific) segment of a TM scope selector
    foreground: number; // palette index, 0 = unset
    italic: boolean;
    bold: boolean;
    underline: boolean;
    strikethrough: boolean;
    selectorLen: number;
  }

  let themeService: any = null;
  let compiledRules: CompiledRule[] = [];
  let ruleIndex = new Map<string, CompiledRule>();
  let scopeCache = new Map<string, number>();

  function rebuildRules(theme: any): void {
    const colorMap: (string | null)[] = theme.tokenColorMap ?? [];
    const colorToIndex = new Map<string, number>();
    colorMap.forEach((hex, idx) => {
      if (hex) colorToIndex.set(hex.toUpperCase(), idx);
    });

    compiledRules = [];
    for (const raw of (theme.tokenColors ?? []) as Array<{ scope?: string | string[]; settings?: any }>) {
      const settings = raw.settings ?? {};
      const fgHex: string | undefined = settings.foreground;
      const fontStyle: string = settings.fontStyle ?? '';
      const fg = fgHex ? (colorToIndex.get(fgHex.toUpperCase()) ?? 0) : 0;
      const italic = /\bitalic\b/.test(fontStyle);
      const bold = /\bbold\b/.test(fontStyle);
      const underline = /\bunderline\b/.test(fontStyle);
      const strikethrough = /\bstrikethrough\b/.test(fontStyle);
      if (fg === 0 && !italic && !bold && !underline && !strikethrough) continue;

      const rawSelectors = Array.isArray(raw.scope) ? raw.scope : raw.scope ? [raw.scope] : [];
      for (const full of rawSelectors) {
        // Split on "," to support `"a, b"` selector syntax. For descendant selectors with
        // spaces (e.g. `meta.import keyword.control`) we approximate by matching the last
        // (most specific) segment only — good enough for Default Dark Modern's rules.
        for (const part of full.split(',')) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const last = trimmed.split(/\s+/).pop()!;
          compiledRules.push({
            selector: last,
            foreground: fg,
            italic,
            bold,
            underline,
            strikethrough,
            selectorLen: last.length,
          });
        }
      }
    }

    // Index by exact selector — the matcher walks dot-trail prefixes and looks up directly.
    // When multiple rules share a selector, longer rules later in the theme override; the
    // theme's later rules also win generally, so keep the LAST occurrence per selector.
    ruleIndex = new Map();
    for (const r of compiledRules) ruleIndex.set(r.selector, r);
    scopeCache = new Map();
  }

  function getThemeService(): any {
    if (themeService) return themeService;
    themeService = StandaloneServices.get(IWorkbenchThemeService);
    rebuildRules(themeService.getColorTheme());
    themeService.onDidColorThemeChange(() => rebuildRules(themeService.getColorTheme()));
    return themeService;
  }

  function encode(scopeChain: string, languageId: number): number {
    const cached = scopeCache.get(scopeChain);
    if (cached !== undefined) return cached;
    if (compiledRules.length === 0) getThemeService();

    const segments = scopeChain.split(' ').filter(Boolean);
    let foreground = 0;
    let italic = false;
    let bold = false;
    let underline = false;
    let strikethrough = false;

    // Rightmost (leaf) scope is most specific; within each segment, trim dot-suffixes leftward
    // to find the longest theme-rule selector that's a dot-prefix of the segment.
    outer: for (let i = segments.length - 1; i >= 0; i--) {
      let s = segments[i];
      while (s) {
        const rule = ruleIndex.get(s);
        if (rule) {
          if (foreground === 0 && rule.foreground !== 0) foreground = rule.foreground;
          if (rule.italic) italic = true;
          if (rule.bold) bold = true;
          if (rule.underline) underline = true;
          if (rule.strikethrough) strikethrough = true;
          if (foreground !== 0) break outer;
          break;
        }
        const dot = s.lastIndexOf('.');
        if (dot === -1) break;
        s = s.slice(0, dot);
      }
    }

    let meta = languageId & 0xff;
    meta |= (foreground & 0x1ff) << FOREGROUND_OFFSET;
    if (italic) meta |= FONT_STYLE_ITALIC;
    if (bold) meta |= FONT_STYLE_BOLD;
    if (underline) meta |= FONT_STYLE_UNDERLINE;
    if (strikethrough) meta |= FONT_STYLE_STRIKETHROUGH;
    meta = meta >>> 0;
    scopeCache.set(scopeChain, meta);
    return meta;
  }

  // The caller awaits `whenReady` from `registerExtension` before invoking us, so all four
  // manifest-contributed languages are registered. We can call `setTokensProvider` directly —
  // bypassing `onLanguage`, which only fires when a model first opens in that language and
  // would never trigger for typescript/javascript/json (only seen through hover fences).
  function attach(languageId: string, tokenizer: Tokenizer): void {
    const langId = monaco.languages.getEncodedLanguageId(languageId);
    monaco.languages.setTokensProvider(languageId, {
      getInitialState: () => new StateWrap(tokenizer.initialState()),
      tokenizeEncoded: (line, state) => {
        const inner = state instanceof StateWrap ? state.inner : tokenizer.initialState();
        const result = tokenizer.tokenize(line, inner);
        const data = new Uint32Array(result.tokens.length * 2);
        for (let i = 0; i < result.tokens.length; i++) {
          data[i * 2] = result.tokens[i].startIndex;
          data[i * 2 + 1] = encode(result.tokens[i].scopes, langId);
        }
        return { tokens: data, endState: new StateWrap(result.endState) };
      },
    });
  }

  attach('typescriptreact', tsxTokenizer);
  attach('typescript', tsxTokenizer);
  attach('javascript', tsxTokenizer);
  attach('json', jsonTokenizer);
}
