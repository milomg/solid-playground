import type * as vscodeNS from 'vscode';
import FormatWorker from './formatWorker?worker';

const PARSER_BY_LANG: Record<string, string> = {
  typescript: 'babel-ts',
  typescriptreact: 'babel-ts',
  javascript: 'babel',
  javascriptreact: 'babel',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
};

export function activateFormatter(vscode: typeof vscodeNS): void {
  const worker = new FormatWorker();
  let nextId = 0;
  const inflight = new Map<number, { resolve(s: string): void; reject(e: unknown): void }>();

  worker.addEventListener('message', ({ data }: MessageEvent<any>) => {
    const pending = inflight.get(data.id);
    if (!pending) return;
    inflight.delete(data.id);
    if (data.event === 'FORMAT') pending.resolve(data.code);
    else pending.reject(new Error(data.error?.message ?? 'format failed'));
  });

  function format(code: string, parser: string): Promise<string> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      inflight.set(id, { resolve, reject });
      worker.postMessage({ event: 'FORMAT', id, code, parser });
    });
  }

  for (const lang of Object.keys(PARSER_BY_LANG)) {
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: lang },
      {
        async provideDocumentFormattingEdits(document) {
          try {
            const formatted = await format(document.getText(), PARSER_BY_LANG[lang]);
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length),
            );
            return [vscode.TextEdit.replace(fullRange, formatted)];
          } catch (e: any) {
            void vscode.window.showErrorMessage(`Format failed: ${e.message}`);
            return [];
          }
        },
      },
    );
  }
}
