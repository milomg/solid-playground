// Severity is exposed in the worker as the eslint scale (1=Warning, 2=Error);
// the extension translates to vscode.DiagnosticSeverity.

import { verify, verifyAndFix } from 'eslint-solid-standalone';
import type { Linter } from 'eslint-solid-standalone';

export interface LinterWorkerPayload {
  event: 'LINT' | 'FIX';
  id: number;
  code: string;
  ruleSeverityOverrides?: Record<string, Linter.Severity>;
}

export interface LintMarker {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
  message: string;
  severity: number; // 2 = error, 1 = warning
}

const messagesToMarkers = (messages: Linter.LintMessage[]): LintMarker[] => {
  if (messages.some((m) => m.fatal)) return [];
  return messages.map((m) => ({
    startLineNumber: m.line,
    endLineNumber: m.endLine ?? m.line,
    startColumn: m.column,
    endColumn: m.endColumn ?? m.column,
    message: `${m.message}\neslint(${m.ruleId})`,
    severity: m.severity,
  }));
};

self.addEventListener('message', ({ data }: MessageEvent<LinterWorkerPayload>) => {
  const { event, id } = data;
  try {
    if (event === 'LINT') {
      self.postMessage({
        event: 'LINT',
        id,
        markers: messagesToMarkers(verify(data.code, data.ruleSeverityOverrides)),
      });
    } else if (event === 'FIX') {
      const fixReport = verifyAndFix(data.code, data.ruleSeverityOverrides);
      self.postMessage({
        event: 'FIX',
        id,
        markers: messagesToMarkers(fixReport.messages),
        output: fixReport.output,
        fixed: fixReport.fixed,
      });
    }
  } catch (e: any) {
    self.postMessage({ event: 'ERROR', id, error: { message: e?.message ?? String(e) } });
  }
});

export {};
