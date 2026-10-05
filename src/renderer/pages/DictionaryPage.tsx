import { useState } from 'react';

import type { AppState } from '../../shared/types';
import { Button, Card, Chip, Notice, Segmented } from '../components/ui';
import { useAction } from '../lib/store';

export function DictionaryPage({ state }: { state: AppState }) {
  const [mode, setMode] = useState<'word' | 'correction'>('word');
  const [word, setWord] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { busy, error, run } = useAction();

  const addWord = () =>
    run('add', async () => {
      if (!word.trim()) return;
      await window.yap.addDictionaryWord(word.trim());
      setWord('');
    });

  const addCorrection = () =>
    run('add', async () => {
      if (!from.trim() || !to.trim()) return;
      await window.yap.addCorrection(from.trim(), to.trim());
      setFrom('');
      setTo('');
    });

  return (
    <>
      <header className="page-header">
        <h1>Dictionary</h1>
        <p>Teach Yap your vocabulary. Names and terms get spelled right, recurring mistakes get fixed.</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card
        title="Add an entry"
        action={
          <Segmented<'word' | 'correction'>
            value={mode}
            options={[
              { value: 'word', label: 'Word' },
              { value: 'correction', label: 'Correction' },
            ]}
            onChange={setMode}
          />
        }
      >
        {mode === 'word' ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addWord();
            }}
          >
            <input className="input" placeholder="Kubernetes, Supabase, DHBW…" value={word} onChange={(event) => setWord(event.target.value)} />
            <Button type="submit" variant="primary" busy={busy === 'add'} disabled={!word.trim()}>
              Add
            </Button>
          </form>
        ) : (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addCorrection();
            }}
          >
            <input className="input" placeholder="Whisper hears…" value={from} onChange={(event) => setFrom(event.target.value)} />
            <span className="arrow">→</span>
            <input className="input" placeholder="Should be…" value={to} onChange={(event) => setTo(event.target.value)} />
            <Button type="submit" variant="primary" busy={busy === 'add'} disabled={!from.trim() || !to.trim()}>
              Add
            </Button>
          </form>
        )}
        <p className="field-hint">
          {mode === 'word'
            ? 'Words are passed to Whisper as spelling hints and to the polishing step.'
            : 'Corrections are applied to every transcript, with or without polishing.'}
        </p>
      </Card>

      <div className="two-columns">
        <Card
          title={
            <>
              Words <Chip>{state.dictionary.length}</Chip>
            </>
          }
        >
          {state.dictionary.length === 0 ? (
            <p className="empty">No words yet.</p>
          ) : (
            <ul className="entry-list">
              {state.dictionary.map((entry) => (
                <li key={entry.word}>
                  <span>{entry.word}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${entry.word}`}
                    onClick={() => void run('remove', () => window.yap.removeDictionaryWord(entry.word))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={
            <>
              Corrections <Chip>{state.corrections.length}</Chip>
            </>
          }
        >
          {state.corrections.length === 0 ? (
            <p className="empty">No corrections yet.</p>
          ) : (
            <ul className="entry-list">
              {state.corrections.map((entry) => (
                <li key={entry.from}>
                  <span>
                    <s className="muted">{entry.from}</s> → <strong>{entry.to}</strong>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${entry.from}`}
                    onClick={() => void run('remove', () => window.yap.removeCorrection(entry.from))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
