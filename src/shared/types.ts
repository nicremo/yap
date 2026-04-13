export type EnhancementLevel = 'none' | 'soft' | 'medium' | 'high';
export type StyleMode = 'conversation' | 'vibe-coding';
export type TranscriptionMode = 'auto' | 'cloud' | 'local';
export type RewriteMode = 'cloud' | 'local';
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

export interface AppSettings {
  storageDirectory: string;
  whisperModel: string;
  whisperLabel: string;
  ollamaBaseUrl: string;
  textModel: string;
  rewriteMode: RewriteMode;
  cloudRewriteModel: string;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  transcriptionMode: TranscriptionMode;
  cloudModel: CloudTranscriptionModel;
  cloudApiBaseUrl: string;
  cloudLanguage: string;
  openaiApiKeyEncrypted: string;
  autoPaste: boolean;
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
  dictionary: DictionaryEntry[];
  corrections: CorrectionEntry[];
  appRules: AppRule[];
  status: AppStatus;
}

export interface ProcessAudioResult {
  rawText: string;
  finalText: string;
  pasted: boolean;
  focusInfo?: FocusInfo;
  transcriptionSource: 'cloud' | 'local';
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
  ollamaBaseUrl?: string;
  storageDirectory?: string;
  autoPaste?: boolean;
  showOverlay?: boolean;
  launchAtLogin?: boolean;
  setupComplete?: boolean;
}
