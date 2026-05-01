const PROGRESS_RING_RADIUS = 16;
const PROGRESS_RING_SVG_SIZE = 40;
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS;
const PROGRESS_RING_NS = "http://www.w3.org/2000/svg";

export interface ProgressRing {
  elRoot: SVGSVGElement;
  elIndicator: SVGCircleElement;
  setOpacity(value: number): void;
  setProgress(progress: number): void;
  setIndeterminate(isIndeterminate: boolean): void;
}

export function createProgressRing() {
  const elRoot = document.createElementNS(PROGRESS_RING_NS, "svg");
  elRoot.classList.add("ytdl-watch-progress-ring");
  elRoot.setAttribute("viewBox", `0 0 ${PROGRESS_RING_SVG_SIZE} ${PROGRESS_RING_SVG_SIZE}`);
  elRoot.setAttribute("aria-hidden", "true");

  const elTrack = document.createElementNS(PROGRESS_RING_NS, "circle");
  elTrack.classList.add("ytdl-watch-progress-ring__track");
  elTrack.setAttribute("cx", String(PROGRESS_RING_SVG_SIZE / 2));
  elTrack.setAttribute("cy", String(PROGRESS_RING_SVG_SIZE / 2));
  elTrack.setAttribute("r", String(PROGRESS_RING_RADIUS));

  const elIndicator = document.createElementNS(PROGRESS_RING_NS, "circle");
  elIndicator.classList.add("ytdl-watch-progress-ring__indicator");
  elIndicator.setAttribute("cx", String(PROGRESS_RING_SVG_SIZE / 2));
  elIndicator.setAttribute("cy", String(PROGRESS_RING_SVG_SIZE / 2));
  elIndicator.setAttribute("r", String(PROGRESS_RING_RADIUS));
  elIndicator.setAttribute("stroke-dasharray", String(PROGRESS_RING_CIRCUMFERENCE));
  elIndicator.setAttribute("stroke-dashoffset", String(PROGRESS_RING_CIRCUMFERENCE));

  elRoot.append(elTrack, elIndicator);

  return {
    elRoot,
    elIndicator,
    setOpacity(value: number) {
      elRoot.style.opacity = String(value);
    },
    setProgress(progress: number) {
      const clamped = Math.max(0, Math.min(1, progress));
      elIndicator.setAttribute("stroke-dashoffset", String(PROGRESS_RING_CIRCUMFERENCE * (1 - clamped)));
    },
    setIndeterminate(isIndeterminate: boolean) {
      elRoot.classList.toggle("ytdl-watch-progress-ring--indeterminate", isIndeterminate);
    }
  };
}
