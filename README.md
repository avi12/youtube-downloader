# YouTube Downloader

A browser extension for downloading videos from YouTube

Made by [avi12](https://avi12.com)

## Supported browsers

<p>
  <img src="https://user-images.githubusercontent.com/6422804/135838451-1c3ac8f1-409f-4aec-972f-1d077c05f1ea.png" width="30" alt="Google Chrome">
  <img src="https://user-images.githubusercontent.com/6422804/135838702-e852bb47-8c0d-4275-baf1-8adc1c50a3c1.png" width="30" alt="Microsoft Edge">
  <img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" width="30" alt="Opera">
  <img src="https://user-images.githubusercontent.com/6422804/135839033-c6caa7a4-72c9-4fc6-9b70-1a9561c1173a.png" width="30" alt="Opera GX">
</p>

<details style="margin-top: 20px;">
<summary>Screenshots</summary>

### For videos that aren't in the Music category:

<img src="https://user-images.githubusercontent.com/6422804/135842811-8acd27e4-d8f2-4297-9e30-277c554255c9.png" alt="Download videos in /watch" />

### For videos in the Music category:

<img src="https://user-images.githubusercontent.com/6422804/135843310-b85b3d2d-b8c1-4704-83d5-51a0a9540811.png" alt="Download music videos in /watch" />
<img src="https://user-images.githubusercontent.com/6422804/135843761-d3c0548c-8028-40b7-9dab-05af8f490bbb.png"  alt="Rich options" />

### In `/playlist`:

<img src="https://user-images.githubusercontent.com/6422804/135844180-33d842c0-d335-4181-8eda-6aa32f9f47e3.png" alt="Downloading a single video in the playlist page" />

<img src="https://user-images.githubusercontent.com/6422804/135844498-0951b974-07dd-4155-9fa2-9d4cdd0d0276.png" alt="Opening the rich options for a single video in a playlist" style="margin: 20px 0;" />

<img src="https://user-images.githubusercontent.com/6422804/135844922-f4da509e-67b2-421c-a9a4-579ef67e721a.png" alt="Options for playlists" />

## Pop-up page

<img src="https://user-images.githubusercontent.com/6422804/135845589-cf654082-7f7c-4d48-8f5a-226dfd88699a.png" alt="Pop-up page: Download manager" style="margin-bottom: 10px" />
<img src="https://user-images.githubusercontent.com/6422804/135846001-2a92e721-8436-4b4f-91a0-5770bdaa41a7.png" alt="Pop-up page: Global options">
</details>

## Installation

Download from **one** of: [AdFly](http://fumacrom.com/3907988/youtube-downloader),
[Linkshrink](https://linkshrink.ca/youtube-downloader),
[AdPayLink](https://go.rancah.com/7hRX), or [direct](https://bit.ly/3tqf9y6)

### Video installation tutorials:

<kbd>
  <a href="https://www.youtube.com/watch?v=aMxenpDBvN4"><img src="https://img.youtube.com/vi/aMxenpDBvN4/maxresdefault.jpg" alt="How to install YouTube Downloader on Google Chrome" style="width: 300px;" /></a>
</kbd>
<br>
<br>
<kbd>
  <a href="https://www.youtube.com/watch?v=lg2ejFFFEBI"><img src="https://img.youtube.com/vi/lg2ejFFFEBI/maxresdefault.jpg" alt="How to install YouTube Downloader on Microsoft Edge" style="width: 300px;" /></a>
</kbd>
<br>
<br>
<kbd>
  <a href="https://www.youtube.com/watch?v=5NvG9kLatnk"><img src="https://img.youtube.com/vi/5NvG9kLatnk/maxresdefault.jpg" alt="How to install YouTube Downloader on Opera" style="width: 300px;" /></a>
</kbd>
<br>
<br>
<kbd>
  <a href="https://www.youtube.com/watch?v=PsgiGNXTNdw"><img src="https://img.youtube.com/vi/PsgiGNXTNdw/maxresdefault.jpg" alt="How to install YouTube Downloader on Opera GX" style="width: 300px;" /></a>
</kbd>

### After installing, reload YouTube tabs

## Features

- Download videos from `/watch` & `/playlist`, either as videos, audio tracks or audio-less videos
- Viewing the download progress
- All downloads are cancelable
- Always keep in mind:
  - Videos with audio tracks will _always_ be downloaded _one-by-one_
  - Audio tracks or audio-less videos will _always_ be downloaded _in parallel_
- Via the pop-up page, you can manage downloads, customize the file extensions and change the default video quality
- Useful tooltips when hovering over certain buttons, notably individual downloads and the playlist download button
- For videos on `/watch`:
  - Clicking to download a video whose category isn't "Music" will:
    - begin downloading in the currently-selected quality (unless customized) if the queue is empty
    - if the queue isn't empty, it will be pushed to the queue
  - Otherwise, it will be downloaded as an audio track immediately
- In playlists on `/playlist`:
  - When downloading an individual video:
    - If you're downloading it as a video, yet you already started downloading a videos that you selected - it will
      abort their downloads and instead begin downloading the video you just clicked Download on
    - Otherwise, it will start downloading immediately as an audio track
  - When selecting multiple videos and clicking the Download button that's tied to the playlist, they'll download
    one-by-one
  - Download a whole playlist with a single click, using "Download all when ready"
  - Set playlist-wide options (download all videos as videos / audio-less videos / audio tracks; use the same file
    extension for all items)

- Pop-up:
  - Options:
    - Control whether to download a video in quality X/the highest available, or download according to the selected
      quality
    - Allow specifying a custom file extension for videos and audios
    - If you have YouTube Premium ,remove the native Download button

## To-dos (when I have time)

- Pop-up:
  - Options:
    - Allow downloading playlists as ZIP
    - Allow downloading playlists to a subdirectory whose name is the playlist's name
- If the video has Clip, opening the Clip modal will allow specifying which portion of the video to download (including
  the rich options, as mentioned above)

## Known bugs

- When downloading video files that include audio, reordering them via the pop-up page will sometimes not correctly
  display right away the download / processing progress in the video's progress bar

## Core packages/repositories used

1. [ytdlr](https://github.com/bakapear/ytdlr) - for converting signature ciphers into downloadable URLs
2. [FFmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) - for combining video & audio into a single video file, and then
   providing it as a download
3. [Vue.js](https://vuejs.org) - for the in-page UI interactivity
4. [Svelte](https://svelte.dev) - for the pop-up page
5. [Svelte Materialify](https://svelte-materialify.vercel.app/) - for using Material Design components in the pop-up
   page. It will be replaced by a different library when it becomes deprecated

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
