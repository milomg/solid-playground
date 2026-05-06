import type * as vscodeNS from 'vscode';
import LintWorker from './lintWorker?worker';

const LINT_DEBOUNCE_MS = 300;
const SUPPORTED_LANGS = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);

interface LintMarker {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
  message: string;
  severity: number;
}

export function activateLinter(vscode: typeof vscodeNS): void {
  const worker = new LintWorker();
  const collection = vscode.languages.createDiagnosticCollection('eslint-solid');
  let nextId = 0;
  const lintInflight = new Map<number, { resolve(m: LintMarker[]): void; reject(e: unknown): void }>();
  const fixInflight = new Map<number, { resolve(o: { fixed: boolean; output: string }): void; reject(e: unknown): void }>();
  const debouncers = new Map<string, ReturnType<typeof setTimeout>>();

  worker.addEventListener('message', ({ data }: MessageEvent<any>) => {
    if (data.event === 'LINT') {
      lintInflight.get(data.id)?.resolve(data.markers);
      lintInflight.delete(data.id);
    } else if (data.event === 'FIX') {
      fixInflight.get(data.id)?.resolve({ fixed: data.fixed, output: data.output });
      fixInflight.delete(data.id);
    } else if (data.event === 'ERROR') {
      lintInflight.get(data.id)?.reject(new Error(data.error?.message));
      fixInflight.get(data.id)?.reject(new Error(data.error?.message));
      lintInflight.delete(data.id);
      fixInflight.delete(data.id);
    }
  });

  function lint(code: string): Promise<LintMarker[]> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      lintInflight.set(id, { resolve, reject });
      worker.postMessage({ event: 'LINT', id, code });
    });
  }

  function fix(code: string): Promise<{ fixed: boolean; output: string }> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      fixInflight.set(id, { resolve, reject });
      worker.postMessage({ event: 'FIX', id, code });
    });
  }

  const toDiagnostic = (m: LintMarker): vscodeNS.Diagnostic => {
    const range = new vscode.Range(
      Math.max(0, m.startLineNumber - 1),
      Math.max(0, m.startColumn - 1),
      Math.max(0, m.endLineNumber - 1),
      Math.max(0, m.endColumn - 1),
    );
    const severity = m.severity === 2 ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
    const d = new vscode.Diagnostic(range, m.message, severity);
    d.source = 'eslint-solid';
    return d;
  };

  const runLint = async (doc: vscodeNS.TextDocument) => {
    if (!SUPPORTED_LANGS.has(doc.languageId)) return;
    try {
      const markers = await lint(doc.getText());
      collection.set(doc.uri, markers.map(toDiagnostic));
    } catch {}
  };

  const scheduleLint = (doc: vscodeNS.TextDocument) => {
    const key = doc.uri.toString();
    const existing = debouncers.get(key);
    if (existing) clearTimeout(existing);
    debouncers.set(
      key,
      setTimeout(() => {
        debouncers.delete(key);
        void runLint(doc);
      }, LINT_DEBOUNCE_MS),
    );
  };

  vscode.workspace.onDidChangeTextDocument((e) => scheduleLint(e.document));
  vscode.workspace.onDidOpenTextDocument(scheduleLint);
  vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri));
  for (const doc of vscode.workspace.textDocuments) scheduleLint(doc);

  vscode.languages.registerCodeActionsProvider(
    Array.from(SUPPORTED_LANGS).map((l) => ({ language: l })),
    {
      async provideCodeActions(document, _range, context) {
        const wantsFixAll = context.only?.contains(vscode.CodeActionKind.SourceFixAll);
        const hasEslintDiag = context.diagnostics.some((d) => d.source === 'eslint-solid');
        if (!wantsFixAll && !hasEslintDiag) return [];
        try {
          const result = await fix(document.getText());
          if (!result.fixed) return [];
          const action = new vscode.CodeAction(
            'Fix all eslint-solid problems',
            wantsFixAll ? vscode.CodeActionKind.SourceFixAll : vscode.CodeActionKind.QuickFix,
          );
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
          edit.replace(document.uri, fullRange, result.output);
          action.edit = edit;
          return [action];
        } catch {
          return [];
        }
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.SourceFixAll] },
  );
}
