# FFmpeg for YouTube (lite)

A stripped-down Chrome extension: paste a YouTube URL (or open the popup on a watch page), write FFmpeg arguments, hit Run.

- `{video}` - best video stream
- `{audio}` - best audio stream
- `{captions}` - first caption track as WebVTT
- Every file FFmpeg writes comes back as a download link

Examples: merge to MP4, audio to MP3, captions to SRT, screenshot at 10s, clip 10s-20s.

Notes:
- FFmpeg runs in WebAssembly inside the popup, so keep the popup open until it finishes
- Streams are held in memory, so very long 4K videos can run out of it
- CPUs without SSE4.1 fall back to the non-SIMD FFmpeg core, downloaded once from jsDelivr (integrity-checked, cached)

Build: `pnpm install && pnpm build && pnpm pack` (zip lands in `.output`)

The full-featured extension lives on `main`.
