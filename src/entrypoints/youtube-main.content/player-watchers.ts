import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import {
  ACTIVE_CAPTION_ATTR,
  capturePlayerCaptionBuses,
  getMoviePlayer,
  isPlayerCaptionTrackData
} from "@/lib/youtube/movie-player";

export function setupAudioTrackWatcher() {
  const player = getMoviePlayer();
  const isPlayerUnavailableOrWatched = !player?.getOption || player.__ytdlAudioWatched;
  if (isPlayerUnavailableOrWatched) {
    return;
  }

  const buses = capturePlayerCaptionBuses(player);
  if (!buses.length) {
    return;
  }

  player.__ytdlAudioWatched = true;

  let lastTrackId: string | null = null;
  for (const bus of buses) {
    bus.subscribe("internalaudioformatchange", (trackId: unknown) => {
      const isValidTrackId = typeof trackId === "string" && trackId && trackId !== lastTrackId;
      if (isValidTrackId) {
        lastTrackId = trackId;
        void crossWorldMessenger.sendMessage(CrossWorldMessage.AudioTrackChanged, { trackId });
      }
    });
  }
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

function clearCaptionAttribute() {
  getMoviePlayer()?.removeAttribute(ACTIVE_CAPTION_ATTR);
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

  function onCaptionCleared() {
    clearCaptionAttribute();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.CaptionTrackChanged, {
      languageCode: "",
      vssId: ""
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

  const buses = capturePlayerCaptionBuses(player);
  if (!buses.length) {
    return;
  }

  let lastVssId: string | null = null;
  function handleCaptionsChanged() {
    const track = player?.getOption?.("captions", "track");
    const isSubtitlesOn = player?.isSubtitlesOn?.() ?? false;
    const hasActiveTrack = isSubtitlesOn && isPlayerCaptionTrackData(track);
    if (hasActiveTrack) {
      if (lastVssId === track.vss_id) {
        return;
      }

      lastVssId = track.vss_id;
      onCaptionTrack({
        languageCode: track.languageCode,
        vssId: track.vss_id
      });
      return;
    }

    if (lastVssId === null) {
      return;
    }

    lastVssId = null;
    onCaptionCleared();
  }

  for (const bus of buses) {
    bus.subscribe("captionschanged", handleCaptionsChanged);
  }
}
