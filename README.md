# YouTube Downloader
A browser extension for downloading videos from YouTube

Made by [avi12](https://avi12.com)

## This is a WIP
Still  in development, for as long as I'm not 100% happy with the result  

## Features
* Download videos from `/watch`
* In videos on `/watch`, clicking Download will download the video in the currently-selected quality
* Download videos from `/playlist`, both individually (i.e. clicking Download on videos) and as a batch (which will download all of them consecutively)
* Clicking Download on multiple videos will queue them up
* Viewing the download progress
* All downloads are cancelable
* Any video downloads as MP4
* Pop-up page:
  * Videos can be reordered
  * Videos' downloads can be canceled (individually and as a batch)

## To-dos
* Pop-up:
  * Options:
    * Filename template (allows specifying the file extension as well)
    * When initiating a download in a `/playlist` - by default download the videos as a ZIP or as individual files
    * By default, whether to download a video in X quality/highest available, or download according to the selected quality
* Rich options for each video:
  * Specify a filename before downloading
  * Specify what to download - video-only, audio-only or video + audio
  * Specify the quality of the video/audio
* If the video has Clip, opening the Clip modal will allow to specify which portion of the video to download (including the rich options, as mentioned above)
* Clicking Download on a music video will download it as MP3, unless specified another format manually or through the settings in the pop-up page
* Improve the styling of buttons, add tooltips

## Installation
1. Use [this](http://fumacrom.com/3907988/youtube-downloader) AdFly link to download the latest version
2. Go to `about:extensions`
3. Enable "Developer mode" (top-right corner usually)
4. Drag & drop the ZIP onto the extensions page
5. Reload any YouTube tab you wish the extension to run on

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
