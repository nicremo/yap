export type EnhancementLevel = 'none' | 'soft' | 'medium' | 'high';
export type StyleMode = 'conversation' | 'vibe-coding';
export type TranscriptionMode = 'auto' | 'cloud' | 'local';
export type RewriteMode = 'cloud' | 'local';
export type CloudRewriteProvider = 'groq' | 'openrouter';
export type CloudTranscriptionModel = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1' | 'whisper-large-v3' | 'whisper-large-v3-turbo' | 'distil-whisper-large-v3-en';

export type OverlayPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'rewriting'
  | 'pasting'
  | 'done'
  | 'error';

export interface DictionaryEntry {
  word: string;
  addedAt: string;
}

export interface CorrectionEntry {
  from: string;
  to: string;
  addedAt: string;
}

export interface AppRule {
  appIdentifier: string;
  label: string;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
}

export interface HotkeyConfig {
  keyCode: number;
  modifiers: number;
  label: string;
}

export interface AppSettings {
  storageDirectory: string;
  whisperModel: string;
  whisperLabel: string;
  ollamaBaseUrl: string;
  textModel: string;
  rewriteMode: RewriteMode;
  cloudRewriteModel: string;
  cloudRewriteProvider: CloudRewriteProvider;
  openrouterApiKeyEncrypted: string;
  openrouterModel: string;
  openrouterSpeedRouting: boolean;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  transcriptionMode: TranscriptionMode;
  cloudModel: CloudTranscriptionModel;
  cloudApiBaseUrl: string;
  cloudLanguage: string;
  openaiApiKeyEncrypted: string;
  hotkey: HotkeyConfig;
  autoPaste: boolean;
  copyToClipboard: boolean;
  showOverlay: boolean;
  launchAtLogin: boolean;
  setupComplete: boolean;
}

export interface PermissionsState {
  microphone: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
  accessibility: boolean;
  inputMonitoring: boolean;
  postEvents: boolean;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  modifiedAt?: string;
}

export interface FocusInfo {
  canPaste: boolean;
  role?: string;
  appName?: string;
  bundleIdentifier?: string;
  processIdentifier?: number;
}

export interface AppStatus {
  phase: OverlayPhase;
  title: string;
  detail: string;
  preview?: string;
  rawText?: string;
}

export interface BootstrapState {
  settings: AppSettings;
  permissions: PermissionsState;
  ollamaReachable: boolean;
  ollamaModels: OllamaModelInfo[];
  recommendedModelInstalled: boolean;
  speechModelReady: boolean;
  helperReady: boolean;
  openaiApiKeySet: boolean;
  openrouterApiKeySet: boolean;
  dictionary: DictionaryEntry[];
  corrections: CorrectionEntry[];
  appRules: AppRule[];
  history: HistoryEntry[];
  status: AppStatus;
}

export type DictationStatus = 'success' | 'transcription-failed' | 'audio-only';
export type RetranscribeMode = 'transcribe-only' | 'transcribe-and-stylize';

export interface HistoryEntry {
  id: string;
  rawText: string;
  finalText: string;
  transcriptionSource: 'cloud' | 'local' | null;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  appName?: string;
  createdAt: string;
  audioFilename: string | null;
  audioExpiresAt: string | null;
  status: DictationStatus;
  errorMessage?: string;
}

export interface ProcessAudioResult {
  rawText: string;
  finalText: string;
  pasted: boolean;
  focusInfo?: FocusInfo;
  transcriptionSource: 'cloud' | 'local';
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
}

export interface DictationRequest {
  wavBase64: string;
  targetFocus?: FocusInfo;
}

export interface HotkeyEvent {
  type: 'down' | 'up';
}

export interface UpdateSettingsInput {
  styleMode?: StyleMode;
  enhancementLevel?: EnhancementLevel;
  transcriptionMode?: TranscriptionMode;
  cloudModel?: CloudTranscriptionModel;
  cloudApiBaseUrl?: string;
  cloudLanguage?: string;
  openaiApiKey?: string;
  textModel?: string;
  rewriteMode?: RewriteMode;
  cloudRewriteModel?: string;
  cloudRewriteProvider?: CloudRewriteProvider;
  openrouterApiKey?: string;
  openrouterModel?: string;
  openrouterSpeedRouting?: boolean;
  ollamaBaseUrl?: string;
  storageDirectory?: string;
  hotkey?: HotkeyConfig;
  autoPaste?: boolean;
  copyToClipboard?: boolean;
  showOverlay?: boolean;
  launchAtLogin?: boolean;
  setupComplete?: boolean;
}
