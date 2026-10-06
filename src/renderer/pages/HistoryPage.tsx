import { useMemo, useState } from 'react';

import { hotkeyLabel } from '../../shared/hotkeys';
import type { AppState } from '../../shared/types';
import { HistoryList } from '../components/HistoryList';
import { Icon } from '../components/Icon';
import { Button, Notice, Segmented } from '../components/ui';
import { useT } from '../lib/i18n';
import { useAction } from '../lib/store';

/** Every dictation, with search and a filter for the ones that failed. */
export function HistoryPage({ state }: { state: AppState }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'failed'>('all');
  const { busy, error, run } = useAction();
  const history = state.history;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history.filter((entry) => {
      if (filter === 'failed' && entry.status === 'success') return false;
      if (!needle) return true;
      return [entry.finalText, entry.rawText, entry.appName ?? ''].some((text) => text.toLowerCase().includes(needle));
    });
  }, [history, query, filter]);

  return (
    <>
      <header className="page-header">
        <h1>{t.history.title}</h1>
        <p>{t.history.lead}</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      {history.length === 0 ? (
        <p className="empty">{t.history.empty(hotkeyLabel(state.settings.hotkey, t.keys))}</p>
      ) : (
        <section className="history-section" aria-label={t.history.allLabel}>
          <div className="history-tools">
            <label className="search search-wide">
              <Icon name="search" size={14} />
              <input
                className="input"
                type="search"
                placeholder={t.history.searchPlaceholder}
                aria-label={t.history.searchLabel}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <Segmented<'all' | 'failed'>
              label={t.history.show}
              value={filter}
              options={[
                { value: 'all', label: t.history.all },
                { value: 'failed', label: t.history.failed },
              ]}
              onChange={setFilter}
            />
            <Button size="sm" variant="ghost" icon="trash" busy={busy === 'clear'} onClick={() => void run('clear', () => window.yap.clearHistory())}>
              {t.history.clearAll}
            </Button>
          </div>
          {visible.length === 0 ? (
            <p className="empty">{filter === 'failed' && !query ? t.history.noFailed : t.history.noMatch}</p>
          ) : (
            <HistoryList entries={visible} />
          )}
        </section>
      )}
    </>
  );
}
