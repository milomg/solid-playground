import { format as prettierFormat } from 'prettier/standalone';
import * as prettierPluginBabel from 'prettier/plugins/babel';
import * as prettierPluginEstree from 'prettier/plugins/estree';

self.addEventListener('message', async ({ data }: MessageEvent<{ event: string; id: number; code: string; parser?: string }>) => {
  const { event, id, code, parser } = data;
  if (event !== 'FORMAT') return;
  try {
    const formatted = await prettierFormat(code, {
      parser: parser ?? 'babel-ts',
      plugins: [prettierPluginBabel, prettierPluginEstree as any],
    });
    self.postMessage({ event: 'FORMAT', id, code: formatted });
  } catch (e: any) {
    self.postMessage({ event: 'ERROR', id, error: { message: e?.message ?? String(e) } });
  }
});

export {};
