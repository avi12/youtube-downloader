# FFmpeg for YouTube (lite)

A stripped-down Chrome extension: open the popup on a YouTube watch page, type a yt-dlp command, hit Run. FFmpeg does the work in WebAssembly and every file lands straight in your Downloads folder.

Leave the URL out and the command runs on the tab you opened the popup on. Playlist URLs (or a playlist page) download every video, using your signed-in session, so private playlists, Liked videos and Watch later work

Supported yt-dlp options:
- Formats: `-f` (selectors with `+`, `/`, `,`, `b`, `bv*`, `ba`, itags, `mp4`/`webm`/`m4a`, filters like `[height<=720]`, `[language=de]`), `-S`, `--prefer-free-formats`
- Audio: `-x`, `--audio-format`, `--audio-quality`
- Containers: `--merge-output-format`, `--remux-video`, `--recode-video`
- Subtitles: `--write-subs`, `--write-auto-subs`, `--all-subs`, `--sub-langs`, `--sub-format`, `--convert-subs`, `--embed-subs`, `--list-subs`
- Extras: `--embed-thumbnail`, `--embed-metadata`, `--embed-chapters`, `--write-thumbnail`, `--write-all-thumbnails`, `--convert-thumbnails`, `--write-description`, `--write-info-json`, `--write-url-link`, `--write-desktop-link`, `--write-webloc-link`, `--parse-metadata`, `--replace-in-metadata`
- Sections: `--download-sections` (`"*10-20"` or a chapter name pattern), `--split-chapters`, `--force-keyframes-at-cuts`
- Output: `-o` (with `subtitle:`, `thumbnail:`, `chapter:` and other type prefixes), `-P`, `--restrict-filenames`, `--trim-filenames`; templates support `%(field)s`, `%(field)05d`, `%(upload_date>%Y-%m-%d)s`, `%(field|default)s`
- Playlists: `-I` / `--playlist-items`, `--playlist-start`, `--playlist-end`, `--playlist-reverse`, `--playlist-random`, `--no-playlist`, `--max-downloads`, `--flat-playlist`
- Filtering: `--match-filters`, `--date`, `--datebefore`, `--dateafter`, `--min-views`, `--max-views`, `--min-filesize`, `--max-filesize`, `--break-on-reject`
- Information: `-F`, `--list-thumbnails`, `--print`, `-j`, `--get-title` and the other `--get-*`, `-s`
- FFmpeg: `--postprocessor-args "ffmpeg:..."` (also `ffmpeg_i:`, `Merger:`, `ExtractAudio:` and so on)
- Network, login, cache and logging options (`--proxy`, `--cookies`, `-r`, `-R`, `--no-warnings` and so on) are accepted and ignored, since the browser handles the connection

Rejected with a message: `--exec`, `--batch-file`, `--download-archive`, `--sponsorblock-*` and any option the extension doesn't know

Example: `yt-dlp -f "bv*[height<=720]+ba[language=de]/b" --embed-subs --sub-langs en --embed-chapters`

Notes:
- FFmpeg runs in WebAssembly inside the popup, so keep the popup open until it finishes
- Streams are held in memory, so very long 4K videos can run out of it
- CPUs without SSE4.1 fall back to the non-SIMD FFmpeg core, downloaded once from jsDelivr (integrity-checked, cached)

Build: `pnpm install && pnpm build && pnpm pack` (zip lands in `.output`)

The full-featured extension lives on `main`.
