// Compact replacement for `@codingame/monaco-vscode-typescript-basics-default-extension`,
// `@codingame/monaco-vscode-json-default-extension`, and
// `@codingame/monaco-vscode-theme-defaults-default-extension`. The stock packages ship every
// language and every default theme; we only need typescriptreact (the editor's primary
// language), typescript/javascript/json (so LSP-hover ```typescript / ```json fenced blocks
// render with color), and Dark Modern. Vendoring just those plus their includes keeps this
// in the ~250 KB range.
//
// Critical surprise: Dark Modern is itself a stub that `include`s `./dark_plus.json` (which
// includes `./dark_vs.json`). Without all three vendored and registered, the theme loader
// silently falls back to a bare `vs-dark` with a 7-entry palette and nothing gets colored.
//
// This module registers the extension at import time — static-import it at the top of an entry
// point so the workbench sees the contributions BEFORE initServices runs.
//
// To resync vendored files with upstream, run:
//   cp node_modules/.pnpm/@codingame+monaco-vscode-typescript-basics-default-extension@*/node_modules/@codingame/monaco-vscode-typescript-basics-default-extension/resources/TypeScriptReact.tmLanguage.json src/extensions/solid-defaults/resources/
//   cp node_modules/.pnpm/@codingame+monaco-vscode-typescript-basics-default-extension@*/node_modules/@codingame/monaco-vscode-typescript-basics-default-extension/resources/language-configuration.json src/extensions/solid-defaults/resources/typescriptreact-language-configuration.json
//   cp node_modules/.pnpm/@codingame+monaco-vscode-json-default-extension@*/node_modules/@codingame/monaco-vscode-json-default-extension/resources/JSON.tmLanguage.json src/extensions/solid-defaults/resources/
//   cp node_modules/.pnpm/@codingame+monaco-vscode-json-default-extension@*/node_modules/@codingame/monaco-vscode-json-default-extension/resources/language-configuration.json src/extensions/solid-defaults/resources/json-language-configuration.json
//   cp node_modules/.pnpm/@codingame+monaco-vscode-theme-defaults-default-extension@*/node_modules/@codingame/monaco-vscode-theme-defaults-default-extension/resources/{dark_modern,dark_plus,dark_vs}.json src/extensions/solid-defaults/resources/

import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions';
import tsxLanguageConfigUrl from './resources/typescriptreact-language-configuration.json?url';
import jsonLanguageConfigUrl from './resources/json-language-configuration.json?url';
import darkModernThemeUrl from './resources/dark_modern.json?url';
import darkPlusThemeUrl from './resources/dark_plus.json?url';
import darkVsThemeUrl from './resources/dark_vs.json?url';
import { registerLanguageTokens } from './registerTokens';

// We don't contribute a TextMate `grammars` entry — tokenization runs through our hand-rolled
// tokenizer (registerTokens → tokenizer.ts) so the workbench's TextMate engine stays out of
// the way. Languages are still contributed so the markdown renderer used in LSP hovers can
// resolve ```typescript / ```javascript / ```json fences to a registered language id.
const manifest = {
  name: 'solid-playground-defaults',
  publisher: 'solidjs',
  version: '0.0.1',
  engines: { vscode: '*' },
  contributes: {
    languages: [
      {
        id: 'typescriptreact',
        aliases: ['TypeScript JSX', 'TypeScript React', 'tsx'],
        extensions: ['.tsx'],
        configuration: './typescriptreact-language-configuration.json',
      },
      {
        id: 'typescript',
        aliases: ['TypeScript', 'ts', 'typescript'],
        extensions: ['.ts', '.cts', '.mts'],
        configuration: './typescriptreact-language-configuration.json',
      },
      {
        id: 'javascript',
        aliases: ['JavaScript', 'javascript', 'js'],
        extensions: ['.js', '.cjs', '.mjs'],
        configuration: './typescriptreact-language-configuration.json',
      },
      {
        id: 'json',
        aliases: ['JSON', 'json'],
        extensions: ['.json'],
        configuration: './json-language-configuration.json',
      },
    ],
    themes: [
      {
        id: 'Default Dark Modern',
        label: 'Dark Modern',
        uiTheme: 'vs-dark',
        path: './themes/dark_modern.json',
      },
    ],
  },
};

const { registerFileUrl, whenReady } = registerExtension(
  manifest as any,
  ExtensionHostKind.LocalProcess,
  { system: true },
);

registerFileUrl('typescriptreact-language-configuration.json', tsxLanguageConfigUrl);
registerFileUrl('json-language-configuration.json', jsonLanguageConfigUrl);
registerFileUrl('themes/dark_modern.json', darkModernThemeUrl);
registerFileUrl('themes/dark_plus.json', darkPlusThemeUrl);
registerFileUrl('themes/dark_vs.json', darkVsThemeUrl);

// `registerLanguageTokens` calls `setTokensProvider`, which throws on unknown language ids.
// Manifest language contributions are processed asynchronously by the workbench, so we wait
// until the extension finishes registering before wiring up tokenization.
void whenReady().then(() => registerLanguageTokens());

export { whenReady };
