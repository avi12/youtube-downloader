import type { MoviePlayerElement, CaptionEventBus, PlayerCaptionTrackData } from "./movie-player-types";

export {
  type MoviePlayerElement,
  type PlayerCaptionTrackData,
  type CaptionEventBus,
  ACTIVE_CAPTION_ATTR,
  ACTIVE_AUDIO_ATTR
} from "./movie-player-types";

export function getMoviePlayer() {
  return document.querySelector<MoviePlayerElement>("#movie_player");
}

export function isPlayerCaptionTrackData(value: unknown): value is PlayerCaptionTrackData {
  return (
    typeof value === "object"
    && value !== null
    && "languageCode" in value
    && "vss_id" in value
  );
}

type CaptionBusContext = {
  state?: Record<string, unknown>;
};

function isGetOptionFunction(value: unknown): value is (module: string, option: string) => unknown {
  return typeof value === "function";
}

function isCaptionBusContext(value: unknown): value is CaptionBusContext {
  return typeof value === "object" && value !== null;
}

function hasSubscribe(value: unknown): value is { subscribe: unknown } {
  return typeof value === "object" && value !== null && "subscribe" in value;
}

function isCaptionEventBus(value: unknown): value is CaptionEventBus {
  return hasSubscribe(value) && typeof value.subscribe === "function";
}

export function capturePlayerCaptionBuses(player: MoviePlayerElement) {
  let proto: MoviePlayerElement | null = player;
  let rawGetOption: ((module: string, option: string) => unknown) | null = null;

  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, "getOption");
    const isGetOption = isGetOptionFunction(desc?.value);
    if (isGetOption) {
      rawGetOption = desc.value;
      break;
    }

    proto = Object.getPrototypeOf(proto);
  }

  const isGetOptionMissing = !rawGetOption;
  if (isGetOptionMissing) {
    return [];
  }

  const origApply = Function.prototype.apply;
  let internalCtx: unknown = null;

  type AnyFunction = (...args: unknown[]) => unknown;

  function captureApply(this: AnyFunction, thisArg: unknown, args: unknown[]) {
    const isCaptionsCall = !internalCtx && Array.isArray(args) && args[0] === "captions";
    if (isCaptionsCall) {
      internalCtx = thisArg;
    }

    return origApply.call(this, thisArg, args);
  }

  try {
    Object.defineProperty(Function.prototype, "apply", {
      value: captureApply,
      configurable: true
    });
    rawGetOption!.call(player, "captions", "track");
  } finally {
    Object.defineProperty(Function.prototype, "apply", {
      value: origApply,
      configurable: true
    });
  }

  if (!isCaptionBusContext(internalCtx)) {
    return [];
  }

  const buses: CaptionEventBus[] = [];
  const state = internalCtx.state ?? {};
  for (const key in state) {
    const value = state[key];
    if (isCaptionEventBus(value)) {
      buses.push(value);
    }
  }

  return buses;
}

export function capturePlayerCaptionBus(player: MoviePlayerElement) {
  return capturePlayerCaptionBuses(player)[0] ?? null;
}
