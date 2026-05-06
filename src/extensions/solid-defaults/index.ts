// Compact replacement for `@codingame/monaco-vscode-typescript-basics-default-extension` and
// `@codingame/monaco-vscode-theme-defaults-default-extension`. The stock packages ship every
// language and every default theme; we only need:
//   - typescriptreact (.tsx) declared as a language with bracket/indent rules
//   - the Default Dark Modern theme
// Syntax highlighting itself is NOT contributed via the TextMate `grammars` manifest entry —
// the workbench's TextMate stack pulls in a heavy WASM oniguruma path that we'd rather avoid.
// Instead we register a hand-rolled tokenizer (registerTokens.ts → tokenizer.ts) directly with
// Monaco's tokens API, backed by `oniguruma-to-es`.
//
// This module registers the extension at import time — static-import it at the top of an entry
// point so the workbench sees the contributions BEFORE initServices runs.
//
// To resync vendored files with upstream, run:
//   cp node_modules/.pnpm/@codingame+monaco-vscode-typescript-basics-default-extension@*/node_modules/@codingame/monaco-vscode-typescript-basics-default-extension/resources/TypeScriptReact.tmLanguage.json src/extensions/solid-defaults/resources/
//   cp node_modules/.pnpm/@codingame+monaco-vscode-typescript-basics-default-extension@*/node_modules/@codingame/monaco-vscode-typescript-basics-default-extension/resources/language-configuration.json src/extensions/solid-defaults/resources/typescriptreact-language-configuration.json
//   cp node_modules/.pnpm/@codingame+monaco-vscode-theme-defaults-default-extension@*/node_modules/@codingame/monaco-vscode-theme-defaults-default-extension/resources/dark_modern.json src/extensions/solid-defaults/resources/

import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions';
import languageConfigUrl from './resources/typescriptreact-language-configuration.json?url';
import darkModernThemeUrl from './resources/dark_modern.json?url';
import { registerTsxTokens } from './registerTokens';

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
        configuration: './language-configuration.json',
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

registerFileUrl('language-configuration.json', languageConfigUrl);
registerFileUrl('themes/dark_modern.json', darkModernThemeUrl);

registerTsxTokens();

export { whenReady };
