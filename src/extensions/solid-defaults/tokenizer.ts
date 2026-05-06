// Hand-rolled TextMate tokenizer over `oniguruma-to-es`. We replace the workbench's TextMate
// stack — the latter pulls in vscode-textmate + a WASM Oniguruma engine, this implements the
// subset we need on top of native ECMAScript regex.
//
// Subset handled:
//   - match / begin-end rules with `name` and `contentName`
//   - captures, beginCaptures, endCaptures (numeric group indices → scope name)
//   - `include`: #repository-key, $self, $base
//   - end-pattern backreferences (\1..\9) substituted with literal text from begin captures
// Not handled (intentionally):
//   - captures with nested `patterns` (we lose sub-coloring inside captures)
//   - external grammars (cross-file `include: source.foo`)
//   - begin/while rules
//
// `oniguruma-to-es` translates Oniguruma patterns to JS RegExps. POSIX classes, lookbehinds,
// and most TS-grammar patterns translate fine; rare incompatibilities throw, and we treat those
// rules as no-ops rather than crashing the tokenizer.

import { toRegExp } from 'oniguruma-to-es';

// --- Raw grammar shapes (subset of TextMate spec) ---
interface RawCapture {
  name?: string;
  patterns?: RawPattern[];
}
interface RawPattern {
  name?: string;
  contentName?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: RawPattern[];
  captures?: Record<string, RawCapture>;
  beginCaptures?: Record<string, RawCapture>;
  endCaptures?: Record<string, RawCapture>;
  include?: string;
}
export interface RawGrammar {
  scopeName?: string;
  patterns: RawPattern[];
  repository?: Record<string, RawPattern>;
}

// --- Compiled rules ---
type CaptureMap = Map<number, string>;

interface MatchRule {
  type: 'match';
  scope?: string;
  raw: string;
  regex: RegExp | null;
  compiled: boolean;
  captures: CaptureMap;
}

interface BeginEndRule {
  type: 'beginEnd';
  scope?: string;
  contentScope?: string;
  rawBegin: string;
  beginRegex: RegExp | null;
  beginCompiled: boolean;
  rawEnd: string;
  beginCaptures: CaptureMap;
  endCaptures: CaptureMap;
  childPatterns: RawPattern[];
  cachedChildren: Rule[] | null;
}

type Rule = MatchRule | BeginEndRule;

// --- Tokenizer state ---
interface Frame {
  scope?: string;
  contentScope?: string;
  endRegex: RegExp;
  endCaptures: CaptureMap;
  rule: BeginEndRule;
}

export interface TokenizerState {
  stack: ReadonlyArray<Frame>;
}

export interface OutputToken {
  startIndex: number;
  scopes: string;
}

// --- Grammar compiler ---
class Grammar {
  private repository: Record<string, RawPattern>;
  private topPatterns: RawPattern[];
  private listCache = new WeakMap<RawPattern[], Rule[]>();

  constructor(raw: RawGrammar) {
    this.repository = raw.repository ?? {};
    this.topPatterns = raw.patterns;
  }

  getTopRules(): Rule[] {
    return this.compileList(this.topPatterns);
  }

  childRulesOf(rule: BeginEndRule): Rule[] {
    if (rule.cachedChildren) return rule.cachedChildren;
    rule.cachedChildren = this.compileList(rule.childPatterns);
    return rule.cachedChildren;
  }

  private compileList(patterns: RawPattern[]): Rule[] {
    const cached = this.listCache.get(patterns);
    if (cached) return cached;
    const out: Rule[] = [];
    this.expand(patterns, new Set(), out);
    this.listCache.set(patterns, out);
    return out;
  }

  private expand(patterns: RawPattern[], visited: Set<string>, out: Rule[]): void {
    for (const p of patterns) {
      if (p.include) {
        if (visited.has(p.include)) continue;
        let target: RawPattern | RawPattern[] | null = null;
        if (p.include === '$self' || p.include === '$base') target = this.topPatterns;
        else if (p.include.startsWith('#')) target = this.repository[p.include.slice(1)] ?? null;
        if (!target) continue;
        const next = new Set(visited);
        next.add(p.include);
        const list = Array.isArray(target) ? target : [target];
        // A bare-container pattern (only `patterns`, no match/begin) — splice in its children.
        if (list.length === 1 && list[0].patterns && !list[0].match && list[0].begin === undefined) {
          this.expand(list[0].patterns!, next, out);
        } else {
          this.expand(list, next, out);
        }
      } else if (p.match !== undefined) {
        out.push({
          type: 'match',
          scope: p.name,
          raw: p.match,
          regex: null,
          compiled: false,
          captures: parseCaptures(p.captures),
        });
      } else if (p.begin !== undefined && p.end !== undefined) {
        out.push({
          type: 'beginEnd',
          scope: p.name,
          contentScope: p.contentName,
          rawBegin: p.begin,
          beginRegex: null,
          beginCompiled: false,
          rawEnd: p.end,
          beginCaptures: parseCaptures(p.beginCaptures ?? p.captures),
          endCaptures: parseCaptures(p.endCaptures ?? p.captures),
          childPatterns: p.patterns ?? [],
          cachedChildren: null,
        });
      } else if (p.patterns) {
        this.expand(p.patterns, visited, out);
      }
    }
  }
}

function parseCaptures(c?: Record<string, RawCapture>): CaptureMap {
  const out: CaptureMap = new Map();
  if (!c) return out;
  for (const k of Object.keys(c)) {
    const name = c[k]?.name;
    if (name) out.set(parseInt(k, 10), name);
  }
  return out;
}

function compileRegex(pattern: string): RegExp | null {
  try {
    return toRegExp(pattern, { global: true, hasIndices: true });
  } catch {
    return null;
  }
}

function ensureMatchRegex(rule: MatchRule): RegExp | null {
  if (!rule.compiled) {
    rule.regex = compileRegex(rule.raw);
    rule.compiled = true;
  }
  return rule.regex;
}

function ensureBeginRegex(rule: BeginEndRule): RegExp | null {
  if (!rule.beginCompiled) {
    rule.beginRegex = compileRegex(rule.rawBegin);
    rule.beginCompiled = true;
  }
  return rule.beginRegex;
}

function compileEndRegex(rawEnd: string, beginMatch: RegExpExecArray): RegExp | null {
  // \N (N=1..9) → escaped literal text from begin's group N. Unmatched groups become empty.
  const substituted = rawEnd.replace(/\\(\d)/g, (_, n) => {
    const text = beginMatch[parseInt(n, 10)];
    return text == null ? '' : escapeRegex(text);
  });
  return compileRegex(substituted);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ScanCandidate {
  regex: RegExp;
  isEnd: boolean;
  rule?: Rule;
}

function findEarliestMatch(line: string, pos: number, candidates: ScanCandidate[]): { idx: number; match: RegExpExecArray } | null {
  let best: { idx: number; match: RegExpExecArray } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i].regex;
    r.lastIndex = pos;
    let m: RegExpExecArray | null;
    try {
      m = r.exec(line);
    } catch {
      continue;
    }
    if (!m) continue;
    if (m.index === pos) return { idx: i, match: m }; // tie: lower index wins
    if (!best || m.index < best.match.index) best = { idx: i, match: m };
  }
  return best;
}

function joinScopes(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' ');
}

function pushToken(tokens: OutputToken[], startIndex: number, scopes: string): void {
  const last = tokens[tokens.length - 1];
  if (last && last.scopes === scopes) return;
  tokens.push({ startIndex, scopes });
}

function emitMatch(
  tokens: OutputToken[],
  match: RegExpExecArray,
  captures: CaptureMap,
  ruleScope: string | undefined,
  baseScope: string,
): void {
  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const indices = match.indices;
  const ruleScopeStr = joinScopes(baseScope, ruleScope);

  if (!indices || captures.size === 0) {
    pushToken(tokens, matchStart, ruleScopeStr);
    return;
  }

  // Break the match into segments at every group boundary, then for each segment pick the
  // deepest (smallest-range) capture group covering it.
  const breakpoints = new Set<number>([matchStart, matchEnd]);
  for (const [groupIdx] of captures) {
    const range = indices[groupIdx];
    if (!range) continue;
    breakpoints.add(range[0]);
    breakpoints.add(range[1]);
  }
  const sorted = [...breakpoints].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a >= b || a < matchStart || b > matchEnd) continue;
    let bestScope: string | undefined;
    let bestLen = Infinity;
    for (const [groupIdx, scope] of captures) {
      const range = indices[groupIdx];
      if (!range) continue;
      if (range[0] <= a && range[1] >= b) {
        const len = range[1] - range[0];
        if (len < bestLen) {
          bestLen = len;
          bestScope = scope;
        }
      }
    }
    pushToken(tokens, a, joinScopes(ruleScopeStr, bestScope));
  }
}

function scopeChain(stack: ReadonlyArray<Frame>): string {
  const parts: string[] = [];
  for (const f of stack) {
    if (f.scope) parts.push(f.scope);
    if (f.contentScope) parts.push(f.contentScope);
  }
  return parts.join(' ');
}

export class Tokenizer {
  private grammar: Grammar;
  private rootScope: string;

  constructor(raw: RawGrammar) {
    this.grammar = new Grammar(raw);
    this.rootScope = raw.scopeName ?? '';
  }

  initialState(): TokenizerState {
    return { stack: [] };
  }

  tokenize(line: string, prev: TokenizerState): { tokens: OutputToken[]; endState: TokenizerState } {
    const tokens: OutputToken[] = [];
    let stack = prev.stack;
    let pos = 0;
    const lineLen = line.length;
    const baseScope = this.rootScope;

    let safety = 0;
    const MAX = lineLen * 4 + 32;

    while (pos <= lineLen) {
      if (++safety > MAX) break;

      const top = stack[stack.length - 1];
      const childRules = top ? this.grammar.childRulesOf(top.rule) : this.grammar.getTopRules();

      const candidates: ScanCandidate[] = [];
      if (top) candidates.push({ regex: top.endRegex, isEnd: true });
      for (const r of childRules) {
        const re = r.type === 'match' ? ensureMatchRegex(r) : ensureBeginRegex(r);
        if (re) candidates.push({ regex: re, isEnd: false, rule: r });
      }

      const best = findEarliestMatch(line, pos, candidates);
      const currentScope = joinScopes(baseScope, scopeChain(stack));

      if (!best) {
        if (pos < lineLen) pushToken(tokens, pos, currentScope);
        break;
      }

      if (best.match.index > pos) pushToken(tokens, pos, currentScope);

      const cand = candidates[best.idx];
      const matchEnd = best.match.index + best.match[0].length;

      if (cand.isEnd) {
        const popping = top!;
        const outerStack = stack.slice(0, -1);
        // End captures live OUTSIDE contentScope but INSIDE the rule's outer scope.
        const outerBase = joinScopes(baseScope, scopeChain(outerStack), popping.scope);
        emitMatch(tokens, best.match, popping.endCaptures, undefined, outerBase);
        stack = outerStack;
        pos = matchEnd;
      } else {
        const rule = cand.rule!;
        if (rule.type === 'match') {
          emitMatch(tokens, best.match, rule.captures, rule.scope, currentScope);
          pos = matchEnd;
        } else {
          // Begin captures use the rule's outer scope, NOT contentScope (which only applies
          // to the body between begin and end).
          const outerBase = joinScopes(baseScope, scopeChain(stack), rule.scope);
          emitMatch(tokens, best.match, rule.beginCaptures, undefined, outerBase);
          const endRegex = compileEndRegex(rule.rawEnd, best.match);
          if (!endRegex) {
            pos = Math.max(pos + 1, matchEnd);
            continue;
          }
          stack = [
            ...stack,
            {
              scope: rule.scope,
              contentScope: rule.contentScope,
              endRegex,
              endCaptures: rule.endCaptures,
              rule,
            },
          ];
          pos = matchEnd;
        }
      }

      if (best.match[0].length === 0 && pos === best.match.index) pos++;
    }

    return { tokens, endState: { stack } };
  }
}
