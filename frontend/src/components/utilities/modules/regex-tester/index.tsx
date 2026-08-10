import { useMemo, useState } from 'react';
import { AlertCircle, Copy, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { PanelLayout, Row, Toggle } from '../../fields';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';

interface RegexOptions {
  pattern: string;
  flagGlobal: boolean;
  flagIgnoreCase: boolean;
  flagMultiline: boolean;
  flagDotAll: boolean;
  flagUnicode: boolean;
  replacement: string;
  showReplace: boolean;
}

const DEFAULT_OPTIONS: RegexOptions = {
  pattern: '',
  flagGlobal: true,
  flagIgnoreCase: false,
  flagMultiline: false,
  flagDotAll: false,
  flagUnicode: false,
  replacement: '',
  showReplace: false,
};

/** Ready-made patterns — the ones worth not rewriting from memory every time. */
const LIBRARY: { label: string; pattern: string }[] = [
  { label: 'Email', pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.-]+" },
  { label: 'URL', pattern: 'https?://[^\\s<>"]+' },
  { label: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b' },
  { label: 'UUID', pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' },
  { label: 'ISO date', pattern: '\\d{4}-\\d{2}-\\d{2}' },
  { label: 'Hex color', pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b' },
  { label: 'Semver', pattern: '\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?' },
  { label: 'Duplicate word', pattern: '\\b(\\w+)\\s+\\1\\b' },
];

/** Matching stops here — a runaway pattern must not freeze the window. */
const MAX_MATCHES = 1000;

interface MatchInfo {
  index: number;
  text: string;
  groups: { name: string; value: string | undefined }[];
}

function buildFlags(options: RegexOptions): string {
  return (
    (options.flagGlobal ? 'g' : '') +
    (options.flagIgnoreCase ? 'i' : '') +
    (options.flagMultiline ? 'm' : '') +
    (options.flagDotAll ? 's' : '') +
    (options.flagUnicode ? 'u' : '')
  );
}

export default function RegexTesterPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<RegexOptions>(ctx, DEFAULT_OPTIONS);
  const [subject, setSubject] = useState('');

  const flags = buildFlags(options);

  const { regex, error } = useMemo(() => {
    if (!options.pattern) return { regex: null, error: null };
    try {
      // Listing every match needs `g`; the user-facing flag only controls
      // whether replace touches all occurrences.
      return { regex: new RegExp(options.pattern, flags.includes('g') ? flags : flags + 'g'), error: null };
    } catch (e) {
      return { regex: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [options.pattern, flags]);

  const matches = useMemo<MatchInfo[]>(() => {
    if (!regex || !subject) return [];
    const found: MatchInfo[] = [];

    for (const m of subject.matchAll(regex)) {
      found.push({
        index: m.index ?? 0,
        text: m[0],
        groups: [
          ...m.slice(1).map((value, i) => ({ name: String(i + 1), value })),
          ...Object.entries(m.groups ?? {}).map(([name, value]) => ({ name, value })),
        ],
      });
      if (found.length >= MAX_MATCHES) break;
    }

    return found;
  }, [regex, subject]);

  /** Text split into plain / matched segments, for highlighting. */
  const segments = useMemo(() => {
    if (!subject) return [];
    const parts: { text: string; match: boolean }[] = [];
    let cursor = 0;

    for (const m of matches) {
      if (m.index > cursor) parts.push({ text: subject.slice(cursor, m.index), match: false });
      // A zero-length match has nothing to paint, but still advances the cursor.
      if (m.text.length > 0) parts.push({ text: m.text, match: true });
      cursor = m.index + m.text.length;
    }
    if (cursor < subject.length) parts.push({ text: subject.slice(cursor), match: false });

    return parts;
  }, [subject, matches]);

  const replaced = useMemo(() => {
    if (!regex || !options.showReplace) return '';
    try {
      // Honour the user's `g` choice here, unlike the listing pass.
      const replaceRegex = new RegExp(options.pattern, flags);
      return subject.replace(replaceRegex, options.replacement);
    } catch {
      return '';
    }
  }, [regex, subject, options.pattern, options.replacement, options.showReplace, flags]);

  return (
    <PanelLayout
      options={
        <>
          <Row label="Pattern">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">/</span>
              <Input
                value={options.pattern}
                placeholder="\\w+"
                onChange={(e) => update({ pattern: e.target.value })}
                className="font-mono"
              />
              <span className="text-muted-foreground">/{flags}</span>
            </div>
          </Row>

          <Row label="Flags">
            <div className="grid grid-cols-2 gap-2">
              <Toggle label="g global" checked={options.flagGlobal} onChange={(v) => update({ flagGlobal: v })} />
              <Toggle label="i ignore case" checked={options.flagIgnoreCase} onChange={(v) => update({ flagIgnoreCase: v })} />
              <Toggle label="m multiline" checked={options.flagMultiline} onChange={(v) => update({ flagMultiline: v })} />
              <Toggle label="s dotAll" checked={options.flagDotAll} onChange={(v) => update({ flagDotAll: v })} />
              <Toggle label="u unicode" checked={options.flagUnicode} onChange={(v) => update({ flagUnicode: v })} />
            </div>
          </Row>

          <Row label="Library">
            <div className="flex flex-wrap gap-1.5">
              {LIBRARY.map((entry) => (
                <Badge
                  key={entry.label}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => update({ pattern: entry.pattern })}
                >
                  {entry.label}
                </Badge>
              ))}
            </div>
          </Row>

          <Toggle
            label="Show replace preview"
            checked={options.showReplace}
            onChange={(showReplace) => update({ showReplace })}
          />

          {options.showReplace && (
            <Row label="Replacement" hint="$1, $<name> and $& are supported.">
              <Input
                value={options.replacement}
                onChange={(e) => update({ replacement: e.target.value })}
                className="font-mono"
              />
            </Row>
          )}

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <>
          <Row label="Test string">
            <Textarea
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Paste the text to match against…"
              className="min-h-32 font-mono text-sm"
            />
          </Row>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="font-mono text-xs">{error}</span>
            </div>
          )}

          {!error && subject && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant={matches.length ? 'default' : 'outline'}>
                  {matches.length}
                  {matches.length >= MAX_MATCHES ? '+' : ''} match
                  {matches.length === 1 ? '' : 'es'}
                </Badge>
                {matches.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => ctx.copy(matches.map((m) => m.text).join('\n'))}
                  >
                    <Copy className="size-4" />
                    Copy matches
                  </Button>
                )}
              </div>

              <Row label="Highlighted">
                <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-sm">
                  {segments.map((segment, i) =>
                    segment.match ? (
                      <mark key={i} className="rounded bg-primary/25 text-foreground">
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={i}>{segment.text}</span>
                    ),
                  )}
                </div>
              </Row>

              {matches.some((m) => m.groups.length > 0) && (
                <Row label="Capture groups">
                  <div className="max-h-56 divide-y overflow-auto rounded-md border">
                    {matches.slice(0, 100).map((m, i) => (
                      <div key={i} className="px-3 py-2 text-sm">
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>#{i + 1}</span>
                          <code className="font-mono">{m.text || '(empty)'}</code>
                          <span>@ {m.index}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {m.groups.map((g) => (
                            <span key={g.name} className="font-mono text-xs">
                              <span className="text-muted-foreground">{g.name}:</span>{' '}
                              {g.value === undefined ? '—' : g.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Row>
              )}

              {options.showReplace && (
                <Row label="After replace">
                  <div className="relative">
                    <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 pr-10 font-mono text-sm">
                      {replaced}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1"
                      onClick={() => ctx.copy(replaced)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </Row>
              )}
            </>
          )}
        </>
      }
    />
  );
}
