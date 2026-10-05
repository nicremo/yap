import type { AppState, LocalWhisperModel } from '../../shared/types';
import { LOCAL_MODELS } from '../../shared/models';
import { useAction } from '../lib/store';
import { Button, Chip, Notice, Progress } from './ui';

export function LocalModelPicker({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const { busy, error, run } = useAction();
  const download = state.engine.localModelDownload;
  const selected = state.settings.localModel;

  const select = (model: LocalWhisperModel) =>
    run('select', async () => onState(await window.yap.updateSettings({ localModel: model })));

  return (
    <div className="local-model">
      <div className="choice-grid choice-grid-compact">
        {LOCAL_MODELS.map((model) => (
          <button
            key={model.id}
            type="button"
            className={`choice${selected === model.id ? ' choice-active' : ''}`}
            disabled={download !== null}
            onClick={() => void select(model.id)}
          >
            <span className="choice-title">
              {model.label}
              <span className="choice-meta">{model.size}</span>
            </span>
            <span className="choice-text">{model.note}</span>
          </button>
        ))}
      </div>

      <div className="local-model-status">
        {download ? (
          <div className="download">
            <div className="download-text">
              <span>Downloading {LOCAL_MODELS.find((model) => model.id === download.model)?.label}</span>
              <span className="mono">{download.detail}</span>
            </div>
            <Progress value={download.progress} />
          </div>
        ) : state.engine.localModelReady ? (
          <Chip tone="success" icon="check">Downloaded and ready</Chip>
        ) : (
          <Button
            variant="primary"
            icon="download"
            busy={busy === 'download'}
            onClick={() => void run('download', async () => onState(await window.yap.downloadLocalModel()))}
          >
            Download model
          </Button>
        )}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
