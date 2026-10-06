import { useMemo, useState } from 'react';

import type { AppState } from '../../shared/types';
import { HistoryList } from '../components/HistoryList';
import { Icon } from '../components/Icon';
import { Button, Notice, Segmented } from '../components/ui';
import { useAction } from '../lib/store';

/** Every dictation, with search and a filter for the ones that failed. */
export function HistoryPage({ state }: { state: AppState }) {
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
        <h1>History</h1>
        <p>Every dictation, newest first. Recordings are kept for seven days, so you can transcribe them again.</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      {history.length === 0 ? (
        <p className="empty">Nothing here yet. Hold {state.settings.hotkey.label} and say something.</p>
      ) : (
        <section className="history-section" aria-label="All dictations">
          <div className="history-tools">
            <label className="search search-wide">
              <Icon name="search" size={14} />
              <input
                className="input"
                type="search"
                placeholder="Search text or app"
                aria-label="Search the history"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <Segmented<'all' | 'failed'>
              label="Show"
              value={filter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'failed', label: 'Failed' },
              ]}
              onChange={setFilter}
            />
            <Button size="sm" variant="ghost" icon="trash" busy={busy === 'clear'} onClick={() => void run('clear', () => window.yap.clearHistory())}>
              Clear all
            </Button>
          </div>
          {visible.length === 0 ? (
            <p className="empty">{filter === 'failed' && !query ? 'No failed dictations.' : 'Nothing matches.'}</p>
          ) : (
            <HistoryList entries={visible} />
          )}
        </section>
      )}
    </>
  );
}
