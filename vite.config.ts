import { defineConfig } from 'vite';
import * as fs from 'node:fs';
import * as path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url).pathname).toString());

const monacoDeps = Object.keys(pkg.dependencies as Record<string, string>).filter(
  (name) => name.startsWith('@codingame/monaco-vscode-') || name === 'monaco-editor' || name === 'vscode',
);
export default defineConfig(({ mode }) => {
  const root =
    mode === 'embed' ? path.resolve(import.meta.dirname, 'src/embed') : path.resolve(import.meta.dirname, 'src/full');
  const onigShim = path.resolve(import.meta.dirname, 'src/shared/vscodeOnigurumaShim.ts');

  return {
    root,
    publicDir: path.resolve(import.meta.dirname, 'public'),
    build: {
      target: 'esnext',
      emptyOutDir: true,
      outDir: path.resolve(import.meta.dirname, mode === 'embed' ? 'dist/embed' : 'dist/full'),
    },
    worker: {
      format: 'es',
    },
    plugins: [
      {
        // The bundled typescript-language-features extension's index.js calls registerFileUrl
        // for diagnostic-message JSONs in 14 locales (cs/de/es/fr/it/ja/ko/pl/pt-br/ru/tr/zh-cn/zh-tw),
        // each ~300–450 KB. Each `new URL(..., import.meta.url)` becomes a separate asset chunk
        // in the build. We're English-only, so rewrite the index.js at load time to drop those
        // registrations — same effect as vendoring a custom index.js, no checked-in copy.
        name: 'ts-language-features-en-only',
        enforce: 'pre',
        async load(id) {
          if (!id.includes('monaco-vscode-typescript-language-features-default-extension/index.js')) {
            return null;
          }
          const original = await fs.promises.readFile(id, 'utf8');
          // Match each `registerFileUrl('dist/browser/typescript/<locale>/diagnosticMessages.generated.json', ...);`
          // for any locale except `en` and drop the whole call.
          const stripped = original.replace(
            /registerFileUrl\('dist\/browser\/typescript\/(?!en\/)[a-z-]+\/diagnosticMessages\.generated\.json',[^;]+;\s*/g,
            '',
          );
          return stripped;
        },
      },
      {
        // Redirect monaco-vscode-textmate-service-override's internal import of vscode-oniguruma
        // (the WASM-backed regex engine) to our @shikijs/engine-javascript-backed shim. Both
        // the main thread (textMateTokenizationFeatureImpl.js) and the worker
        // (textMateTokenizationWorker.worker.js) reach for `_virtual/main2.js`.
        name: 'oniguruma-shim',
        enforce: 'pre',
        async resolveId(source, importer) {
          if (!importer) return null;
          if (
            (source.endsWith('_virtual/main2.js') || source.endsWith('vscode-oniguruma/release/main.js')) &&
            importer.includes('monaco-vscode-textmate-service-override')
          ) {
            return onigShim;
          }
          return null;
        },
      },
      {
        name: 'load-vscode-css-as-string',
        enforce: 'pre',
        async resolveId(source, importer, options) {
          const resolved = await this.resolve(source, importer, options);
          if (!resolved) return undefined;
          if (resolved.id.match(/node_modules\/(@codingame\/monaco-vscode|vscode|monaco-editor).*\.css$/)) {
            return { ...resolved, id: resolved.id + '?inline' };
          }
          return undefined;
        },
      },
      {
        // typescript-language-features uses SharedArrayBuffer between the extension host and the
        // tsserver worker, which requires cross-origin isolation. Dev-server only — for a
        // production deploy, set the same headers in your CDN/host config.
        name: 'cross-origin-isolation',
        apply: 'serve',
        configureServer: (server) => {
          server.middlewares.use((_req, res, next) => {
            res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            next();
          });
        },
      },
    ],
    esbuild: {
      minifySyntax: false,
    },
    optimizeDeps: {
      include: [
        ...monacoDeps,
        '@codingame/monaco-vscode-api/extensions',
        '@codingame/monaco-vscode-api/monaco',
        'vscode/localExtensionHost',
        '@babel/standalone',
        'babel-preset-solid',
        'dedent',
        'prettier/standalone',
        'prettier/plugins/babel',
        'prettier/plugins/estree',
        'eslint-solid-standalone',
      ],
    },
    resolve: {
      dedupe: ['vscode', 'monaco-editor', ...monacoDeps],
    },
    define: {
      'process.env.NODE_DEBUG': 'false',
    },
  };
});
