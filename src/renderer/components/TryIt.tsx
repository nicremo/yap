import { useEffect, useRef, useState } from 'react';

import { formatSeconds } from '../../shared/i18n';
import type { AppState } from '../../shared/types';
import { rich, useI18n } from '../lib/i18n';
import { HotkeyCap } from './HotkeyCap';

/** A text box to dictate into, with the live status underneath. */
export function TryIt({ state, autoFocus = false }: { state: AppState; autoFocus?: boolean }) {
  const { locale, t } = useI18n();
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const { status } = state;

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  return (
    <div className="try-it">
      <p className="muted">{rich(t.tryIt.hint, { key: <HotkeyCap state={state} /> })}</p>
      <textarea
        ref={area}
        className="input try-area"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t.tryIt.placeholder}
      />
      <div className="try-status" role="status" aria-live="polite">
        <span className={`status-dot status-dot-${status.phase}`} />
        <span>
          <strong>{status.title}</strong> {status.detail}
        </span>
        {status.phase === 'done' && status.metrics && <span className="latency">{formatSeconds(status.metrics.totalMs, locale)}</span>}
      </div>
    </div>
  );
}
