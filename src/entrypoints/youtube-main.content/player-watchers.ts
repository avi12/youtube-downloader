import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import {
  ACTIVE_AUDIO_ATTR,
  ACTIVE_CAPTION_ATTR,
  capturePlayerCaptionBuses,
  getMoviePlayer,
  isPlayerCaptionTrackData
} from "@/lib/youtube/movie-player";
import type { MoviePlayerElement } from "@/lib/youtube/movie-player";

const AD_PLAYER_CLASSES = ["ad-showing", "ad-interrupting"];
const AUDIO_TRACK_ID_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)?\.\d+$/;
const PLAYER_EVENT_INTERNAL_AUDIO_FORMAT_CHANGE = "internalaudioformatchange";
const PLAYER_EVENT_CAPTIONS_CHANGED = "captionschanged";
const PLAYER_OPTION_CAPTIONS = "captions";
const PLAYER_OPTION_TRACK = "track";
const PLAYER_CLASS_ATTR = "class";
const VIDEO_EVENT_PLAYING = "playing";

function isAdPlaying(player: MoviePlayerElement | null) {
  return !!player && AD_PLAYER_CLASSES.some(adClass => player.classList.contains(adClass));
}

function isAudioTrackId(value: string) {
  return AUDIO_TRACK_ID_PATTERN.test(value);
}

function hasTrackDescriptorShape(value: unknown): value is {
  id: unknown;
  isAutoDubbed: unknown;
} {
  return typeof value === "object" && value !== null && "id" in value && "isAutoDubbed" in value;
}

function readActiveAudioTrackId(player: MoviePlayerElement | null) {
  const track = player?.getAudioTrack?.();
  if (!track) {
    return null;
  }

  for (const value of Object.values(track)) {
    if (hasTrackDescriptorShape(value) && typeof value.id === "string") {
      return value.id;
    }
  }

  return null;
}

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
  function reportTrack(trackId: string) {
    const isNewValidTrack = isAudioTrackId(trackId) && trackId !== lastTrackId;
    const isTrackSkipped = !isNewValidTrack || isAdPlaying(player);
    if (isTrackSkipped) {
      return;
    }

    lastTrackId = trackId;
    player?.setAttribute(ACTIVE_AUDIO_ATTR, trackId);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.AudioTrackChanged, { trackId });
  }

  for (const bus of buses) {
    bus.subscribe(PLAYER_EVENT_INTERNAL_AUDIO_FORMAT_CHANGE, trackId => {
      if (typeof trackId === "string") {
        reportTrack(trackId);
      }
    });
  }

  function syncAudioFromPlayer() {
    const trackId = readActiveAudioTrackId(player);
    if (trackId) {
      reportTrack(trackId);
    }
  }

  syncAudioFromPlayer();
  document.querySelector("video")?.addEventListener(VIDEO_EVENT_PLAYING, syncAudioFromPlayer);
  new MutationObserver(syncAudioFromPlayer).observe(player, {
    attributes: true,
    attributeFilter: [PLAYER_CLASS_ATTR]
  });
}

type WriteCaptionAttributeParams = {
  languageCode: string;
  vssId: string;
};
function writeCaptionAttribute({ languageCode, vssId }: WriteCaptionAttributeParams) {
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

  function onCaptionTrack({ languageCode, vssId }: WriteCaptionAttributeParams) {
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
    const track = player?.getOption?.(PLAYER_OPTION_CAPTIONS, PLAYER_OPTION_TRACK);
    if (isPlayerCaptionTrackData(track)) {
      onCaptionTrack({
        languageCode: track.languageCode,
        vssId: track.vss_id
      });
    }
  }

  syncCaptionFromPlayer();
  document.querySelector("video")?.addEventListener(VIDEO_EVENT_PLAYING, syncCaptionFromPlayer, { once: true });

  const buses = capturePlayerCaptionBuses(player);
  if (!buses.length) {
    return;
  }

  let lastVssId: string | null = null;
  function handleCaptionsChanged() {
    const track = player?.getOption?.(PLAYER_OPTION_CAPTIONS, PLAYER_OPTION_TRACK);
    const isSubtitlesOn = player?.isSubtitlesOn?.() ?? false;
    const isActiveTrackPresent = isSubtitlesOn && isPlayerCaptionTrackData(track);
    if (isActiveTrackPresent) {
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
    bus.subscribe(PLAYER_EVENT_CAPTIONS_CHANGED, handleCaptionsChanged);
  }
}
