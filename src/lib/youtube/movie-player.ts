import { required } from "@/lib/required";
import type { CaptionEventBus, MoviePlayerElement } from "./movie-player-types";
import { captionEventBusSchema, isCaptionBusContext, playerCaptionTrackDataSchema } from "./schemas";
import { z } from "@/lib/zod";
import { createGuard, createShapeGuard } from "@/lib/zod-guard";

export {
  ACTIVE_AUDIO_ATTR,
  ACTIVE_CAPTION_ATTR,
  type MoviePlayerElement,
  type PlayerCaptionTrackData
} from "./movie-player-types";

// The player's methods are all optional, so being an HTML element is all there is to check
const isMoviePlayer = createShapeGuard<MoviePlayerElement>(z.lazy(() => z.instanceof(HTMLElement)));

export function getMoviePlayer() {
  const elPlayer = document.querySelector("#movie_player");
  return isMoviePlayer(elPlayer) ? elPlayer : null;
}

export const isPlayerCaptionTrackData = createGuard(playerCaptionTrackDataSchema);

const getOptionSchema = z.function({
  input: [z.string(), z.string()],
  output: z.unknown()
});
const isGetOption = createGuard(getOptionSchema);
const isCaptionEventBus = createGuard(captionEventBusSchema);

export function capturePlayerCaptionBuses(player: MoviePlayerElement) {
  let proto: MoviePlayerElement | null = player;
  let rawGetOption: z.infer<typeof getOptionSchema> | null = null;

  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, "getOption");
    if (isGetOption(desc?.value)) {
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
    required(rawGetOption).call(player, "captions", "track");
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
  const { state = {} } = internalCtx;
  for (const value of Object.values(state)) {
    if (isCaptionEventBus(value)) {
      buses.push(value);
    }
  }

  return buses;
}
