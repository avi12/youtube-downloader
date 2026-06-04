import type { MoviePlayerElement, CaptionEventBus, PlayerCaptionTrackData } from "./movie-player-types";
import { captionBusContextSchema, captionEventBusSchema, playerCaptionTrackDataSchema } from "./schemas";

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
  return playerCaptionTrackDataSchema.safeParse(value).success;
}

type GetOptionFn = (module: string, option: string) => unknown;

function isGetOptionFn(value: unknown): value is GetOptionFn {
  return typeof value === "function";
}

function isCaptionEventBus(value: unknown): value is CaptionEventBus {
  return captionEventBusSchema.safeParse(value).success;
}

export function capturePlayerCaptionBuses(player: MoviePlayerElement) {
  let proto: MoviePlayerElement | null = player;
  let rawGetOption: GetOptionFn | null = null;

  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, "getOption");
    if (isGetOptionFn(desc?.value)) {
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

  function captureApply(this: AnyFunction, thisArg: unknown, callArgs: unknown[]) {
    const isContextUncaptured = !internalCtx;
    const isCaptionsArgs = Array.isArray(callArgs) && callArgs[0] === "captions";
    const isCaptionsCall = isContextUncaptured && isCaptionsArgs;
    if (isCaptionsCall) {
      internalCtx = thisArg;
    }

    return origApply.call(this, thisArg, callArgs);
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

  const ctxResult = captionBusContextSchema.safeParse(internalCtx);
  if (!ctxResult.success) {
    return [];
  }

  const buses: CaptionEventBus[] = [];
  const state = ctxResult.data.state ?? {};
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
