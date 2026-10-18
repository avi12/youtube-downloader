# FFmpeg for YouTube (lite)

A stripped-down Chrome extension: open the popup on a YouTube watch page, type a yt-dlp command, hit Run. FFmpeg does the work in WebAssembly and every file lands straight in your Downloads folder.

Supported yt-dlp options:
- `-f` / `--format`: selectors with `+`, `/`, `b`, `bv*`, `ba`, itags and filters like `[height<=720]`, `[language=de]`, `[ext=mp4]`
- `-S` / `--format-sort`: `res`, `fps`, `br`, `abr`, `size`, `vcodec`, `acodec`, with `+` and `:limit`
- `-x`, `--audio-format`, `--audio-quality`
- `--merge-output-format`, `--remux-video`, `--recode-video`
- `--write-subs`, `--write-auto-subs`, `--all-subs`, `--sub-langs`, `--sub-format`, `--convert-subs`
- `--skip-download`, `--download-sections "*10-20"`, `-o` with `%(title)s`, `%(id)s`, `%(ext)s`, `%(height)s`, `%(uploader)s`
- `-F` lists the formats

Anything else is rejected with a clear message instead of being ignored

Example: `yt-dlp -f "bv*[height<=720]+ba[language=de]/b" --write-subs --sub-langs en "https://www.youtube.com/watch?v=..."`

Notes:
- FFmpeg runs in WebAssembly inside the popup, so keep the popup open until it finishes
- Streams are held in memory, so very long 4K videos can run out of it
- CPUs without SSE4.1 fall back to the non-SIMD FFmpeg core, downloaded once from jsDelivr (integrity-checked, cached)

Build: `pnpm install && pnpm build && pnpm pack` (zip lands in `.output`)

The full-featured extension lives on `main`.
