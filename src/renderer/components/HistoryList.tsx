import { useState } from 'react';

import { formatSeconds, type Locale, type Messages } from '../../shared/i18n';
import type { DictationStatus, HistoryEntry, RetranscribeMode } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/store';
import { Icon } from './Icon';
import { Button, Chip, Notice, type Tone } from './ui';

const DAY_MS = 24 * 60 * 60 * 1000;

export function audioCountdown(entry: HistoryEntry, t: Messages): string {
  const expires = entry.audioExpiresAt
    ? new Date(entry.audioExpiresAt).getTime()
    : new Date(entry.createdAt).getTime() + 7 * DAY_MS;
  const remaining = expires - Date.now();
  if (remaining <= 0) return t.history.audioExpired;
  const days = Math.floor(remaining / DAY_MS);
  return days >= 1 ? t.history.audioDays(days) : t.history.audioHours(Math.max(1, Math.round(remaining / 3_600_000)));
}

export function describeStatus(status: DictationStatus, t: Messages): { label: string; tone: Tone } | null {
  if (status === 'transcription-failed') return { label: t.history.statusFailed, tone: 'danger' };
  if (status === 'audio-only') return { label: t.history.statusNotTranscribed, tone: 'warning' };
  return null;
}

export function formatTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string, locale: Locale, t: Messages): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return formatTime(iso, locale);
  if (date.toDateString() === yesterday.toDateString()) return t.history.yesterday(formatTime(iso, locale));
  return `${date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${formatTime(iso, locale)}`;
}

/** Polish actually applied: older entries do not record the model, the text change tells. */
export function appliedPolish(entry: HistoryEntry, t: Messages): string {
  const polished = Boolean(entry.rewriteModel) || (entry.rawText !== '' && entry.rawText !== entry.finalText);
  return t.polish.levels[polished ? entry.enhancementLevel : 'off'];
}

function HistoryRow({ entry, open, onToggle }: { entry: HistoryEntry; open: boolean; onToggle: () => void }) {
  const { locale, t } = useI18n();
  const [copied, setCopied] = useState<'final' | 'raw' | null>(null);
  const { busy, error, run } = useAction();
  const failure = describeStatus(entry.status, t);
  const hasAudio = Boolean(entry.audioFilename);
  const working = busy === 'retranscribe';
  const headline =
    entry.finalText ||
    entry.rawText ||
    (entry.status === 'transcription-failed' ? entry.errorMessage ?? t.history.transcriptionFailed : t.history.notTranscribedYet);

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
          <span>{formatDate(entry.createdAt, locale, t)}</span>
          {entry.latencyMs !== undefined && <span className="mono">{formatSeconds(entry.latencyMs, locale)}</span>}
        </span>
        <Icon name="chevronDown" size={16} className="history-chevron" />
      </button>

      {open && (
        <div className="history-detail">
          {entry.rawText && entry.rawText !== entry.finalText && (
            <div className="raw-block">
              <span className="field-label">{t.history.originalTranscript}</span>
              <p>{entry.rawText}</p>
            </div>
          )}
          {entry.errorMessage && <Notice tone={entry.status === 'success' ? 'neutral' : 'danger'}>{entry.errorMessage}</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="meta">
            <span>{t.history.styleAndPolish(t.style.names[entry.styleMode] ?? entry.styleMode, appliedPolish(entry, t))}</span>
            {entry.appRule && <span>{t.home.appRuleFor(entry.appRule)}</span>}
            {entry.transcriptionSource && (
              <span>{entry.transcriptionSource === 'cloud' ? t.common.groqCloud : t.common.onThisComputer}</span>
            )}
            <span>{hasAudio ? audioCountdown(entry, t) : t.history.audioExpired}</span>
          </div>
          <div className="history-actions">
            <Button size="sm" variant="secondary" icon={copied === 'final' ? 'check' : 'copy'} disabled={!entry.finalText} onClick={() => copy('final')}>
              {copied === 'final' ? t.common.copied : t.common.copy}
            </Button>
            {entry.rawText && entry.rawText !== entry.finalText && (
              <Button size="sm" variant="secondary" onClick={() => copy('raw')}>
                {copied === 'raw' ? t.common.copied : t.history.copyOriginal}
              </Button>
            )}
            <Button size="sm" variant="secondary" icon="refresh" disabled={!hasAudio} busy={working} onClick={() => void retranscribe('transcribe-only')}>
              {t.history.transcribeAgain}
            </Button>
            <Button size="sm" variant="secondary" icon="sparkles" disabled={!hasAudio} busy={working} onClick={() => void retranscribe('transcribe-and-stylize')}>
              {t.history.transcribeAndPolish}
            </Button>
            <Button size="sm" variant="ghost" icon="folder" disabled={!hasAudio} onClick={() => void run('reveal', () => window.yap.revealAudio(entry.id))}>
              {t.history.showAudio}
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => void run('remove', () => window.yap.removeHistoryEntry(entry.id))}>
              {t.common.delete}
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
