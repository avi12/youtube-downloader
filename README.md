# YouTube Downloader

A browser extension for downloading videos from YouTube

Made by [avi12](https://avi12.com)

## This is a WIP

Still in development, for as long as I'm not 100% happy with the result

## Features

* Download videos from `/watch`
* In videos on `/watch`:
  * If the video isn't in the "Music" category, clicking Download will download the video in the currently-selected
    quality as MP4
  * Otherwise, it will be downloaded as MP3
* In playlists on `/playlist`:
  * When clicking on an individual video (i.e. clicking Download on a video):
    * If the video isn't in the "Music" category, it will start downloading and make the other non-music videos queue up
    * Otherwise, if it is in "Music", it will start downloading immediately
  * When selecting multiple videos and clicking the Download button that's tied to the playlist:
    * For any non-music video, they will download one-by-one
    * For any music video, they will download as MP3s in parallel (be careful with your bandwidth)
* Viewing the download progress
* All downloads are cancelable
* Pop-up page:
  * Videos (non-music) can be reordered
  * Videos' downloads can be canceled (individually and as a batch)

## To-dos

* Pop-up:
  * Options:
    * Filename template (allows specifying the file extension as well)
    * When initiating a download in a `/playlist` - by default download the videos as a ZIP or as individual files
    * By default, whether to download a video in quality X/the highest available, or download according to the selected
      quality
* Rich options for each video:
  * Specify a filename before downloading
  * Specify what to download - video-only, audio-only or video + audio
  * Specify the quality of the video/audio
* If the video has Clip, opening the Clip modal will allow specifying which portion of the video to download (including
  the rich options, as mentioned above)
* Clicking Download on a music video will download it as MP3, unless specified another format manually or through the
  settings in the pop-up page
* Improve the styling of buttons, add tooltips

## Installation

1. To get the latest version, use **one** of the links: [AdFly](http://fumacrom.com/3907988/youtube-downloader)
   , [Linkshrink](https://linkshrink.ca/youtube-downloader),
   or [direct](https://github.com/avi12/youtube-downloader/releases/latest/download/youtube-downloader.zip)
2. Go to the extensions page
3. Enable "Developer mode" (top-right corner usually)
4. Drag & drop the ZIP onto the extensions page
5. Reload any YouTube tab you wish the extension to run on

## Core packages/repositories used

1. [ytdlr](https://github.com/bakapear/ytdlr) - for converting signature ciphers into downloadable URLs
2. [FFmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) - for combining video & audio into a single video file, and then
   providing it as a download
3. [Vue.js](https://vuejs.org) - for the in-page UI interactivity
4. [Svelte](https://svelte.dev) - for the pop-up page

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
