import type { MoviePlayerElement, CaptionEventBus, PlayerCaptionTrackData } from "./movie-player-types";

export {
  type MoviePlayerElement,
  type PlayerCaptionTrackData,
  type CaptionEventBus,
  ACTIVE_CAPTION_ATTR
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
  state?: {
    L?: CaptionEventBus;
  };
};

function isGetOptionFunction(value: unknown): value is (module: string, option: string) => unknown {
  return typeof value === "function";
}

function isCaptionBusContext(value: unknown): value is CaptionBusContext {
  return typeof value === "object" && value !== null;
}

export function capturePlayerCaptionBus(player: MoviePlayerElement): CaptionEventBus | null {
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
    return null;
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
    return null;
  }

  return internalCtx.state?.L ?? null;
}
