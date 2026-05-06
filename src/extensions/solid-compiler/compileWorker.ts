import { transform } from '@babel/standalone';
// @ts-ignore — CJS, no types
import babelPresetSolid from 'babel-preset-solid';
import dedent from 'dedent';

interface Tab {
  name: string;
  source: string;
}

function uid(str: string) {
  return Array.from(str)
    .reduce((s, c) => (Math.imul(31, s) + c.charCodeAt(0)) | 0, 0)
    .toString();
}

function babelTransform(filename: string, code: string, externals: Record<string, string>): string {
  const handleImportee = (node: { value: string } | null | undefined) => {
    if (!node || typeof node.value !== 'string') return;
    const importee = node.value;
    if (importee.startsWith('.')) {
      node.value = 'solidrepl:' + importee;
    } else if (!importee.includes('://')) {
      if (!(importee in externals)) externals[importee] = `https://esm.sh/${importee}`;
    }
  };

  const { code: transformedCode } = transform(code, {
    plugins: [
      function importRewriter() {
        return {
          visitor: {
            Import(path: any) {
              handleImportee(path.parent.arguments[0]);
            },
            ImportDeclaration(path: any) {
              handleImportee(path.node.source);
            },
            ExportAllDeclaration(path: any) {
              handleImportee(path.node.source);
            },
            ExportNamedDeclaration(path: any) {
              handleImportee(path.node.source);
            },
          },
        };
      },
    ],
    presets: [
      [babelPresetSolid, { generate: 'dom', hydratable: false }],
      ['typescript', { onlyRemoveTypeImports: true }],
    ],
    filename,
  });

  return transformedCode!.replace('render(', 'window.dispose = render(');
}

function transformTab(tab: Tab, externals: Record<string, string>): string {
  if (tab.name.endsWith('.css')) {
    const id = uid(tab.name);
    return dedent`
      (() => {
        let stylesheet = document.getElementById('${id}');
        if (!stylesheet) {
          stylesheet = document.createElement('style')
          stylesheet.setAttribute('id', '${id}')
          document.head.appendChild(stylesheet)
        }
        const styles = document.createTextNode(\`${tab.source.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`)
        stylesheet.innerHTML = ''
        stylesheet.appendChild(styles)
      })()
    `;
  }
  return babelTransform(tab.name, tab.source, externals);
}

function compile(tabs: Tab[]) {
  const externals: Record<string, string> = {};
  const compiled: Record<string, string> = {};
  for (const tab of tabs) {
    const key = `./${tab.name.replace(/\.(tsx|jsx)$/, '')}`;
    compiled[key] = transformTab(tab, externals);
  }
  return { event: 'ROLLUP', compiled, externals };
}

self.addEventListener('message', ({ data }) => {
  const { event, tabs, id } = data as { event: string; tabs: Tab[]; id: number };
  try {
    if (event === 'ROLLUP') {
      const result = compile(tabs);
      self.postMessage({ ...result, id });
    }
  } catch (e: any) {
    console.error('[solid-compiler worker] error', e);
    self.postMessage({ event: 'ERROR', id, error: { message: e?.message ?? String(e), stack: e?.stack } });
  }
});

console.log('[solid-compiler worker] ready');

export {};
