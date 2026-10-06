import { useState } from 'react';

import type { AppState } from '../../shared/types';
import { GROQ_CONSOLE_URL } from '../../shared/models';
import { useT } from '../lib/i18n';
import { useAction } from '../lib/store';
import { Icon } from './Icon';
import { Button, Chip, Notice } from './ui';

export function GroqKeyField({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const t = useT();
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const { busy, error, run, clearError } = useAction();
  const connected = state.engine.groqKeySet && !replacing;

  const save = () =>
    run('save', async () => {
      const { result, state: next } = await window.yap.saveGroqKey(key);
      onState(next);
      if (!result.valid) {
        throw new Error(result.error ?? t.groqKey.rejected);
      }
      setKey('');
      setReplacing(false);
    });

  if (connected) {
    return (
      <div className="key-field key-field-connected">
        <span className="key-field-status">
          <Icon name="key" size={16} />
          <span>{t.groqKey.label}</span>
          <Chip tone="success" icon="check">
            {t.common.connected}
          </Chip>
        </span>
        <div className="key-field-actions">
          <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
            {t.common.replace}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            busy={busy === 'clear'}
            onClick={() => void run('clear', async () => onState(await window.yap.clearGroqKey()))}
          >
            {t.common.remove}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="key-field">
      <form
        className="key-field-input"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim()) void save();
        }}
      >
        <input
          type="password"
          className="input input-mono"
          placeholder="gsk_…"
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setKey(event.target.value);
            clearError();
          }}
        />
        <Button type="submit" variant="primary" busy={busy === 'save'} disabled={!key.trim()}>
          {t.groqKey.verify}
        </Button>
        {replacing && (
          <Button variant="ghost" onClick={() => setReplacing(false)}>
            {t.common.cancel}
          </Button>
        )}
      </form>
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="button" className="inline-link" onClick={() => void window.yap.openExternal(GROQ_CONSOLE_URL)}>
        {t.groqKey.getKey} <Icon name="external" size={12} />
      </button>
    </div>
  );
}
