import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions';
import * as vscodeNS from 'vscode';
import { activateCompiler, type CompilerExports } from './solid-compiler/extension';
import { activateFormatter } from './solid-formatter/extension';
import { activateLinter } from './solid-linter/extension';
import { activateShare } from './solid-share/extension';
import { activateFs } from './solid-fs/extension';
import { activateAccount } from './solid-account/extension';
import type { APIRepl } from '../shared/api';

export interface SolidExtensionApi {
  vscode: typeof vscodeNS;
  compiler: CompilerExports;
}

export type HostMode = 'full' | 'embed';

export interface SolidExtensionsOptions {
  /** False for remote-repl loads — solid-fs uses this to skip persisting the repl into scratchpad. */
  persistLocally: boolean;
  /** When the URL identified a repl (`/{user}/{replId}`), the resolved repl. */
  repl?: APIRepl;
}

export async function registerSolidExtensions(
  mode: HostMode,
  opts: SolidExtensionsOptions,
): Promise<SolidExtensionApi> {
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

  activateFs(vscode, opts.persistLocally);
  const compiler = activateCompiler(vscode, mode);
  activateFormatter(vscode);
  activateLinter(vscode);
  activateShare(vscode);
  if (mode === 'full') activateAccount(vscode, opts.repl);

  return { vscode, compiler };
}
