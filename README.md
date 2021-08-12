# YouTube Downloader
A browser extension for downloading videos from YouTube

Made by [avi12](https://avi12.com)

## This is a WIP
Still  in development, for as long as I'm not 100% happy with the result  

## Installation
1. Use [this](http://fumacrom.com/3907988/youtube-downloader) AdFly link to download the latest version
2. Go to `about:extensions`
3. Drag & drop the ZIP onto the extensions page

## Core packages/repositories used
1. [ytdlr](https://github.com/bakapear/ytdlr) - for converting signature ciphers into downloadable URLs
2. [FFmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) - for combining video & audio into a single video file, and then providing it as a download
3. [Browser ID3 Writer](https://github.com/egoroof/browser-id3-writer) - for attaching ID3 data to videos that are downloaded as music tracks
4. [Vue.js](https://vuejs.org) - for the in-page UI interactivity

## Setting for development
1. Make sure to have [Node.js](https://nodejs.org) and [PNPM](https://pnpm.js.org/en/installation)  
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
