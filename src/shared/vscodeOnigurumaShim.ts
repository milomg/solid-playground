// Replacement for the bundled `vscode-oniguruma` inside monaco-vscode-textmate-service-override.
//
// The TextMate worker's `_virtual/main2.js` re-exports from the package's vendored vscode-oniguruma
// (which loads a 250 KB Oniguruma WASM blob). We swap it for `@shikijs/engine-javascript`, which
// translates Oniguruma patterns to native ECMAScript regex via `oniguruma-to-es`. No WASM means
// no MIME-type / streaming-compile hazards, and the bundle gets ~250 KB smaller.
//
// The worker calls these functions:
//   await vscodeOniguruma.loadWASM(bytes);
//   const onigLib = { createOnigScanner: vscodeOniguruma.createOnigScanner, createOnigString: ... };
// We expose the same surface, plus a default export that mimics the original `_virtual/main2.js`
// shape so the worker's namespace destructuring keeps working.

import { JavaScriptScanner, defaultJavaScriptRegexConstructor } from '@shikijs/engine-javascript';

class OnigString {
  content: string;
  constructor(s: string | { content: string }) {
    this.content = typeof s === 'string' ? s : s.content;
  }
  dispose() {}
}

class OnigScanner {
  private scanner: JavaScriptScanner;
  constructor(patterns: string[]) {
    this.scanner = new JavaScriptScanner(patterns, {
      forgiving: true,
      regexConstructor: (p: string) => defaultJavaScriptRegexConstructor(p, {}),
    });
  }
  findNextMatchSync(string: string | OnigString, startPosition: number) {
    return this.scanner.findNextMatchSync(string, startPosition, 0);
  }
  dispose() {}
}

export async function loadWASM(_bytes?: ArrayBuffer | { data: ArrayBuffer }): Promise<void> {
  // No-op: the JS engine handles regex compilation natively.
}

export function createOnigScanner(patterns: string[]) {
  return new OnigScanner(patterns);
}

export function createOnigString(s: string) {
  return new OnigString(s);
}

export { OnigScanner, OnigString };

// `_virtual/main2.js` exports both `default` and `main` namespaces with these symbols.
// The worker reads `n.main` after `await import(...)`, so we provide the same shape.
export const main = { loadWASM, createOnigScanner, createOnigString, OnigScanner, OnigString };
export default main;
