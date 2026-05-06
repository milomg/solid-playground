// Wires our hand-rolled TextMate tokenizer (tokenizer.ts) into Monaco's tokens API for
// `typescriptreact`. The grammar JSON is bundled inline by Vite (~185 KB pre-gzip) — we'd
// otherwise have to fetch it at runtime, which races first paint.

import * as monaco from 'monaco-editor';
import grammarJson from './resources/TypeScriptReact.tmLanguage.json';
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

let registered = false;

export function registerTsxTokens(): void {
  if (registered) return;
  registered = true;

  const tokenizer = new Tokenizer(grammarJson as unknown as RawGrammar);

  // Defer until the language exists — order between the manifest registration and Monaco's
  // language registry isn't guaranteed at module-load time.
  monaco.languages.onLanguage('typescriptreact', () => {
    monaco.languages.setTokensProvider('typescriptreact', {
      getInitialState: () => new StateWrap(tokenizer.initialState()),
      tokenize: (line, state) => {
        const inner = state instanceof StateWrap ? state.inner : tokenizer.initialState();
        const { tokens, endState } = tokenizer.tokenize(line, inner);
        return { tokens, endState: new StateWrap(endState) };
      },
    });
  });
}
