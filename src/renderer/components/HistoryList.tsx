import { useState } from 'react';

import type { DictationStatus, HistoryEntry, RetranscribeMode } from '../../shared/types';
import { polishLabel } from '../lib/polish';
import { formatSeconds, useAction } from '../lib/store';
import { STYLE_LABELS } from '../lib/style-content';
import { Icon } from './Icon';
import { Button, Chip, Notice, type Tone } from './ui';

const DAY_MS = 24 * 60 * 60 * 1000;

export function audioCountdown(entry: HistoryEntry): string {
  const expires = entry.audioExpiresAt
    ? new Date(entry.audioExpiresAt).getTime()
    : new Date(entry.createdAt).getTime() + 7 * DAY_MS;
  const remaining = expires - Date.now();
  if (remaining <= 0) return 'Audio expired';
  const days = Math.floor(remaining / DAY_MS);
  return days >= 1
    ? `Audio kept ${days} more ${days === 1 ? 'day' : 'days'}`
    : `Audio kept ${Math.max(1, Math.round(remaining / 3_600_000))} more h`;
}

export function describeStatus(status: DictationStatus): { label: string; tone: Tone } | null {
  if (status === 'transcription-failed') return { label: 'Failed', tone: 'danger' };
  if (status === 'audio-only') return { label: 'Not transcribed', tone: 'warning' };
  return null;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return formatTime(iso);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${formatTime(iso)}`;
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${formatTime(iso)}`;
}

/** Polish actually applied: older entries do not record the model, the text change tells. */
export function appliedPolish(entry: HistoryEntry): string {
  const polished = Boolean(entry.rewriteModel) || (entry.rawText !== '' && entry.rawText !== entry.finalText);
  return polished ? polishLabel(entry.enhancementLevel) : 'Off';
}

function HistoryRow({ entry, open, onToggle }: { entry: HistoryEntry; open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState<'final' | 'raw' | null>(null);
  const { busy, error, run } = useAction();
  const failure = describeStatus(entry.status);
  const hasAudio = Boolean(entry.audioFilename);
  const working = busy === 'retranscribe';
  const headline =
    entry.finalText ||
    entry.rawText ||
    (entry.status === 'transcription-failed' ? entry.errorMessage ?? 'Transcription failed.' : 'Audio saved, not transcribed yet.');

  const copy = (which: 'final' | 'raw') =>
    void navigator.clipboard.writeText(which === 'raw' ? entry.rawText : entry.finalText).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1_200);
    });
  const retranscribe = (mode: RetranscribeMode) => run('retranscribe', () => window.yap.retranscribe(entry.id, mode));

  return (
    <li className={`history-item${open ? ' history-item-open' : ''}${failure ? ' history-item-failed' : ''}`}>
      <button type="button" className="history-summary" aria-expanded={open} onClick={onToggle}>
        <span className="history-text">{headline}</span>
        <span className="history-meta">
          {failure && <Chip tone={failure.tone}>{failure.label}</Chip>}
          {entry.appName && <span>{entry.appName}</span>}
          <span>{formatDate(entry.createdAt)}</span>
          {entry.latencyMs !== undefined && <span className="mono">{formatSeconds(entry.latencyMs)}</span>}
        </span>
        <Icon name="chevronDown" size={16} className="history-chevron" />
      </button>

      {open && (
        <div className="history-detail">
          {entry.rawText && entry.rawText !== entry.finalText && (
            <div className="raw-block">
              <span className="field-label">Original transcript</span>
              <p>{entry.rawText}</p>
            </div>
          )}
          {entry.errorMessage && <Notice tone={entry.status === 'success' ? 'neutral' : 'danger'}>{entry.errorMessage}</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="meta">
            <span>
              {STYLE_LABELS[entry.styleMode] ?? entry.styleMode}, polish {appliedPolish(entry)}
            </span>
            {entry.appRule && <span>App rule for {entry.appRule}</span>}
            {entry.transcriptionSource && <span>{entry.transcriptionSource === 'cloud' ? 'Groq cloud' : 'On this computer'}</span>}
            <span>{hasAudio ? audioCountdown(entry) : 'Audio expired'}</span>
          </div>
          <div className="history-actions">
            <Button size="sm" variant="secondary" icon={copied === 'final' ? 'check' : 'copy'} disabled={!entry.finalText} onClick={() => copy('final')}>
              {copied === 'final' ? 'Copied' : 'Copy'}
            </Button>
            {entry.rawText && entry.rawText !== entry.finalText && (
              <Button size="sm" variant="secondary" onClick={() => copy('raw')}>
                {copied === 'raw' ? 'Copied' : 'Copy original'}
              </Button>
            )}
            <Button size="sm" variant="secondary" icon="refresh" disabled={!hasAudio} busy={working} onClick={() => void retranscribe('transcribe-only')}>
              Transcribe again
            </Button>
            <Button size="sm" variant="secondary" icon="sparkles" disabled={!hasAudio} busy={working} onClick={() => void retranscribe('transcribe-and-stylize')}>
              Transcribe and polish
            </Button>
            <Button size="sm" variant="ghost" icon="folder" disabled={!hasAudio} onClick={() => void run('reveal', () => window.yap.revealAudio(entry.id))}>
              Show audio
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => void run('remove', () => window.yap.removeHistoryEntry(entry.id))}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Dictations as rows that open to show the original, details and actions. */
export function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ul className="history-list">
      {entries.map((entry) => (
        <HistoryRow
          key={entry.id}
          entry={entry}
          open={expanded === entry.id}
          onToggle={() => setExpanded((current) => (current === entry.id ? null : entry.id))}
        />
      ))}
    </ul>
  );
}
