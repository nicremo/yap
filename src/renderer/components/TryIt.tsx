import { useEffect, useRef, useState } from 'react';

import type { AppState } from '../../shared/types';
import { formatSeconds } from '../lib/store';
import { HotkeyCap } from './HotkeyCap';

/** A text box to dictate into, with the live status underneath. */
export function TryIt({ state, autoFocus = false }: { state: AppState; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const { status } = state;

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  return (
    <div className="try-it">
      <p className="muted">
        Click into the box, hold <HotkeyCap state={state} />, say a sentence and let go.
      </p>
      <textarea
        ref={area}
        className="input try-area"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Your words land here…"
      />
      <div className="try-status" role="status" aria-live="polite">
        <span className={`status-dot status-dot-${status.phase}`} />
        <span>
          <strong>{status.title}</strong> {status.detail}
        </span>
        {status.phase === 'done' && status.metrics && <span className="latency">{formatSeconds(status.metrics.totalMs)}</span>}
      </div>
    </div>
  );
}
