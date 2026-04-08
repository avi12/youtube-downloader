# Download Button UX Fix Plan

## Current Problems
1. **No visible progress during fetch**: SabrStream fetch takes 3-30+ seconds but reports 0% progress. The button shows "Cancel" with no feedback that anything is happening.
2. **Progress bar never appears**: `elProgressBar.style.opacity` stays "0" because `downloadProgress` is only updated during FFmpeg muxing (which is very fast).
3. **No transition between states**: Button jumps from "Cancel" → "Download" (done) with no intermediate visual.

## Root Cause
The progress pipeline only emits updates from FFmpeg muxing (`pipelineProgress`). The SabrStream fetch phase (which is the longest part) has no progress reporting.

## Fix: Two-Phase Progress

### Phase 1: Indeterminate progress during SabrStream fetch
- When `isDownloading && downloadProgress === 0`, show `tp-yt-paper-progress` in **indeterminate** mode (animated striping, no percentage)
- This gives immediate visual feedback that the download is in progress

### Phase 2: Determinate progress during FFmpeg mux
- When `downloadProgress > 0`, switch to determinate mode with the actual value
- This is the existing behavior, just needs the bar to be visible

## Changes

### `youtube-main.content.ts` - `refreshButtons()`
```
Current:
  const isProgressVisible = isDownloading && downloadProgress > 0;

Fix:
  const isProgressVisible = isDownloading;
  elProgressBar.indeterminate = isDownloading && downloadProgress === 0;
  elProgressBar.value = Math.round(downloadProgress * 100);
  elProgressBar.style.opacity = isProgressVisible ? "1" : "0";
```

### Button state transitions
```
Idle:        "Download" icon, progress hidden
Downloading: "Cancel" icon, progress bar visible (indeterminate)
Muxing:      "Cancel" icon, progress bar visible (determinate, 50-100%)
Done:        "Download" icon (checkmark), progress hidden
```

## Files
- `src/entrypoints/youtube-main.content.ts` - refreshButtons(), button state logic
