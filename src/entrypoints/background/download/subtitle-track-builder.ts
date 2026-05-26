import type { CaptionTrack } from "@/types";

type BuildSubtitleTracksParams = {
  captionTracks: CaptionTrack[] | undefined;
  captionVttData: (string | null)[];
};
export function buildSubtitleTracks({ captionTracks, captionVttData }: BuildSubtitleTracksParams) {
  const subtitleTracks: {
    dataBase64: string;
    label: string;
    languageCode: string;
  }[] = [];
  for (const [i, track] of (captionTracks ?? []).entries()) {
    const dataBase64 = captionVttData[i];
    if (dataBase64) {
      subtitleTracks.push({
        dataBase64,
        label: track.name.simpleText,
        languageCode: track.languageCode
      });
    }
  }

  return subtitleTracks;
}
