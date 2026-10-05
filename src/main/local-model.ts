import type { AppSettings, LocalModelDownload } from '../shared/types';
import { isLocalModelReady, prepareLocalModel } from './local-whisper';
import { getStoragePaths } from './storage';

/**
 * Tracks whether the selected local Whisper model is on disk, downloads it
 * with progress, and keeps it loaded while local mode is active so the first
 * dictation is not the one that waits for the model to load.
 */
export class LocalModelManager {
  private ready = false;
  private download: LocalModelDownload | null = null;
  private downloadPromise: Promise<void> | null = null;

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly onChange: () => void,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  get currentDownload(): LocalModelDownload | null {
    return this.download;
  }

  async refresh(): Promise<boolean> {
    const settings = this.getSettings();
    const ready = await isLocalModelReady(getStoragePaths(settings).models, settings.localModel);
    if (ready !== this.ready) {
      this.ready = ready;
      this.onChange();
    }
    return ready;
  }

  /** Downloads and loads the selected model. Concurrent calls share one download. */
  downloadSelected(): Promise<void> {
    if (this.downloadPromise) {
      return this.downloadPromise;
    }

    const settings = this.getSettings();
    const model = settings.localModel;
    this.download = { model, progress: 0, detail: 'Starting download…' };
    this.onChange();

    let lastReported = 0;
    this.downloadPromise = prepareLocalModel(getStoragePaths(settings).models, model, ({ progress, detail }) => {
      const now = Date.now();
      // The library reports per chunk; the UI needs a few updates per second at most.
      if (now - lastReported < 150 && progress < 1) return;
      lastReported = now;
      this.download = { model, progress, detail };
      this.onChange();
    })
      .then(async () => {
        this.download = null;
        await this.refresh();
        this.onChange();
      })
      .catch((error: unknown) => {
        this.download = null;
        this.onChange();
        throw error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        this.downloadPromise = null;
      });

    return this.downloadPromise;
  }

  /** Loads the model into memory in the background when local mode will need it. */
  warmUp(): void {
    const settings = this.getSettings();
    if (settings.transcriptionMode !== 'local' || !this.ready || this.downloadPromise) {
      return;
    }
    void prepareLocalModel(getStoragePaths(settings).models, settings.localModel).catch((error) => {
      console.warn('[yap] local model could not be loaded:', error instanceof Error ? error.message : error);
    });
  }
}
