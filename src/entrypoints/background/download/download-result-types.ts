export interface DownloadResult {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: Array<{
    data: Uint8Array | null;
    mimeType: string;
    label: string;
    languageCode: string;
    isDefault: boolean;
  }>;
  isPartialVideo?: boolean;
  isPartialAudio?: boolean;
  streamedToOffscreen?: boolean;
}
