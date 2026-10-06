import { useState } from 'react';

import type { AppState } from '../../shared/types';
import { Button, Card, Chip, Notice, Segmented } from '../components/ui';
import { useT } from '../lib/i18n';
import { useAction } from '../lib/store';

export function DictionaryPage({ state }: { state: AppState }) {
  const t = useT();
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
        <h1>{t.dictionary.title}</h1>
        <p>{t.dictionary.lead}</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card
        title={t.dictionary.addEntry}
        action={
          <Segmented<'word' | 'correction'>
            label={t.dictionary.entryType}
            value={mode}
            options={[
              { value: 'word', label: t.dictionary.word },
              { value: 'correction', label: t.dictionary.correction },
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
            <input className="input" placeholder={t.dictionary.wordPlaceholder} value={word} onChange={(event) => setWord(event.target.value)} />
            <Button type="submit" variant="primary" busy={busy === 'add'} disabled={!word.trim()}>
              {t.common.add}
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
            <input className="input" placeholder={t.dictionary.fromPlaceholder} value={from} onChange={(event) => setFrom(event.target.value)} />
            <span className="arrow">→</span>
            <input className="input" placeholder={t.dictionary.toPlaceholder} value={to} onChange={(event) => setTo(event.target.value)} />
            <Button type="submit" variant="primary" busy={busy === 'add'} disabled={!from.trim() || !to.trim()}>
              {t.common.add}
            </Button>
          </form>
        )}
        <p className="field-hint">
          {mode === 'word' ? t.dictionary.wordHint : t.dictionary.correctionHint}
        </p>
      </Card>

      <div className="two-columns">
        <Card
          title={
            <>
              {t.dictionary.words} <Chip>{state.dictionary.length}</Chip>
            </>
          }
        >
          {state.dictionary.length === 0 ? (
            <p className="empty">{t.dictionary.noWords}</p>
          ) : (
            <ul className="entry-list">
              {state.dictionary.map((entry) => (
                <li key={entry.word}>
                  <span>{entry.word}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t.dictionary.removeEntry(entry.word)}
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
              {t.dictionary.corrections} <Chip>{state.corrections.length}</Chip>
            </>
          }
        >
          {state.corrections.length === 0 ? (
            <p className="empty">{t.dictionary.noCorrections}</p>
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
                    aria-label={t.dictionary.removeEntry(entry.from)}
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
