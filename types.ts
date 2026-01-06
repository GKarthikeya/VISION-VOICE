
export enum View {
  VOICE_HUB = 'voice_hub'
}

export interface VisionLog {
  id: string;
  text: string;
  timestamp: number;
}

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface AppLanguage {
  code: string;
  name: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: AppLanguage[] = [
  { code: 'en-US', name: 'English', label: 'English' },
  { code: 'hi-IN', name: 'Hindi', label: 'हिन्दी' },
  { code: 'te-IN', name: 'Telugu', label: 'తెలుగు' },
  { code: 'es-ES', name: 'Spanish', label: 'Español' }
];
