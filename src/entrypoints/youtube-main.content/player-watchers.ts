import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import {
  ACTIVE_CAPTION_ATTR,
  capturePlayerCaptionBus,
  getMoviePlayer,
  isPlayerCaptionTrackData
} from "@/lib/youtube/movie-player";

export function setupAudioTrackWatcher() {
  const player = getMoviePlayer();
  const isPlayerUnavailableOrWatched = !player?.getOption || player.__ytdlAudioWatched;
  if (isPlayerUnavailableOrWatched) {
    return;
  }

  const bus = capturePlayerCaptionBus(player);
  if (!bus) {
    return;
  }

  player.__ytdlAudioWatched = true;

  bus.subscribe("internalaudioformatchange", (trackId: unknown) => {
    const isValidTrackId = typeof trackId === "string" && trackId;
    if (isValidTrackId) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.AudioTrackChanged, { trackId });
    }
  });
}

function writeCaptionAttribute({ languageCode, vssId }: {
  languageCode: string;
  vssId: string;
}) {
  getMoviePlayer()?.setAttribute(
    ACTIVE_CAPTION_ATTR, JSON.stringify({
      languageCode,
      vss_id: vssId
    })
  );
}

export function setupCaptionTrackWatcher() {
  const player = getMoviePlayer();
  const isPlayerUnavailableOrWatched = !player?.getOption || player.__ytdlCaptionWatched;
  if (isPlayerUnavailableOrWatched) {
    return;
  }

  player.__ytdlCaptionWatched = true;

  function onCaptionTrack({ languageCode, vssId }: {
    languageCode: string;
    vssId: string;
  }) {
    writeCaptionAttribute({
      languageCode,
      vssId
    });
    void crossWorldMessenger.sendMessage(CrossWorldMessage.CaptionTrackChanged, {
      languageCode,
      vssId
    });
  }

  function syncCaptionFromPlayer() {
    const track = player?.getOption?.("captions", "track");
    if (isPlayerCaptionTrackData(track)) {
      onCaptionTrack({
        languageCode: track.languageCode,
        vssId: track.vss_id
      });
    }
  }

  syncCaptionFromPlayer();
  document.querySelector("video")?.addEventListener("playing", syncCaptionFromPlayer, { once: true });

  const bus = capturePlayerCaptionBus(player);
  if (!bus) {
    return;
  }

  bus.subscribe("captionschanged", (trackData: unknown) => {
    if (isPlayerCaptionTrackData(trackData)) {
      onCaptionTrack({
        languageCode: trackData.languageCode,
        vssId: trackData.vss_id
      });
    }
  });
}
