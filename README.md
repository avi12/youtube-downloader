# YouTube Downloader
A browser extension for downloading videos from YouTube.

Made by [avi12](https://avi12.com)

## Core packages/repositories used
1. [ytdlr](https://github.com/bakapear/ytdlr) - for converting signature ciphers into downloadable URLs
1. [FFmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) - for combining video & audio into a single video file, and then providing it as a download

## Setting for development
1. Make sure to have [Node.js](https://nodejs.org) and [PNPM](https://pnpm.js.org/en/installation).  
1. ```bash
    pnpm i
    ```
1. Start Rollup for development
    ```bash
    pnpm dev
    ```
1. Test on Chrome/Chromium
    ```bash
   pnpm run-chromium 
   ```