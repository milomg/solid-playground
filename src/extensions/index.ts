import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions';
import * as vscodeNS from 'vscode';
import { activateCompiler, type CompilerExports } from './solid-compiler/extension';
import { activateFormatter } from './solid-formatter/extension';
import { activateLinter } from './solid-linter/extension';
import { activateShare } from './solid-share/extension';
import { activateFs } from './solid-fs/extension';
import { activateAccount } from './solid-account/extension';

export interface SolidExtensionApi {
  vscode: typeof vscodeNS;
  compiler: CompilerExports;
}

export type HostMode = 'full' | 'embed';

export async function registerSolidExtensions(mode: HostMode): Promise<SolidExtensionApi> {
  const handle = registerExtension(
    {
      name: 'solid-playground',
      publisher: 'solidjs',
      version: '0.0.1',
      engines: { vscode: '*' },
      contributes: {
        commands: [
          { command: 'solid.compile.showOutput', title: 'Show Compiled Output', category: 'Solid' },
          ...(mode === 'full'
            ? [{ command: 'solid.compile.preview', title: 'Show Preview', category: 'Solid' }]
            : []),
        ],
      },
    } as any,
    ExtensionHostKind.LocalProcess,
  );
  await handle.setAsDefaultApi();
  const vscode = (await handle.getApi()) as typeof vscodeNS;

  activateFs(vscode);
  const compiler = activateCompiler(vscode, mode);
  activateFormatter(vscode);
  activateLinter(vscode);
  activateShare(vscode);
  if (mode === 'full') activateAccount(vscode);

  return { vscode, compiler };
}
