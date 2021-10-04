# YouTube Downloader

A browser extension for downloading videos from YouTube

Made by [avi12](https://avi12.com)

## Supported browsers

<img src="https://user-images.githubusercontent.com/6422804/135838451-1c3ac8f1-409f-4aec-972f-1d077c05f1ea.png" width="30" alt="Google Chrome" style="margin-right: 5px;">
<img src="https://user-images.githubusercontent.com/6422804/135838702-e852bb47-8c0d-4275-baf1-8adc1c50a3c1.png" width="30" alt="Microsoft Edge" style="margin-right: 5px;">
<img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" width="30" alt="Opera" style="margin-right: 5px;">
<img src="https://user-images.githubusercontent.com/6422804/135839033-c6caa7a4-72c9-4fc6-9b70-1a9561c1173a.png" width="30" alt="Opera GX">

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
<kbd>
  <a href="https://www.youtube.com/watch?v=lg2ejFFFEBI"><img src="https://img.youtube.com/vi/lg2ejFFFEBI/maxresdefault.jpg" alt="How to install YouTube Downloader on Google Chrome" style="width: 300px;" /></a>
</kbd>
<br>
<kbd>
  <a href="https://www.youtube.com/watch?v=5NvG9kLatnk"><img src="https://img.youtube.com/vi/5NvG9kLatnk/maxresdefault.jpg" alt="How to install YouTube Downloader on Google Chrome" style="width: 300px;" /></a>
</kbd>
<br>
<kbd>
  <a href="https://www.youtube.com/watch?v=PsgiGNXTNdw"><img src="https://img.youtube.com/vi/PsgiGNXTNdw/maxresdefault.jpg" alt="How to install YouTube Downloader on Google Chrome" style="width: 300px;" /></a>
</kbd>

### After installing, reload YouTube tabs

## Features

- Download videos from `/watch` & `/playlist`
- Viewing the download progress
- All downloads are cancelable
- Always keep in mind:
  - When downloading videos with audio tracks, they will _always_ be downloaded one-by-one
  - When downloading audio tracks or audio-less videos, they will _always_ be downloaded _in parallel_
- For videos on `/watch`:
  - If the video isn't in the "Music" category, clicking Download will by default:
    - if the video queue is empty, the video will begin downloading
    - otherwise, it will be _pushed_ into the queue, and will begin downloading after all the videos before it have
      finished (though, it can be reordered via the pop-up page)
  - When initializing a download for videos not in "Music", the video will download in the currently-selected quality as
    MP4, unless specified otherwise in the rich options modal (see below)
  - Otherwise, by default, it will be downloaded as an MP3
- In playlists on `/playlist`:
  - When downloading an individual video:
    - If the video isn't in the "Music" category, and you already started downloading a videos that you selected - it
      will first begin downloading the video you just clicked Download on
    - Otherwise, by default, it will start downloading immediately as an audio file, unless specified otherwise in the
      rich options (see below)
  - When selecting multiple videos and clicking the Download button that's tied to the playlist: see above in "Always
    keep in mind"
  - Download a whole playlist with a single click, using "Download all when ready"
  - Set playlist-wide options (download all videos as videos / video-only / audio tracks; use the same file extension
    for all items)
- Pop-up page:
  - Videos that download with audio can be reorderede
  - Videos' downloads can be canceled, including music ones and audio-less video ones (individually and multiple)
- Rich options:
  - In `/watch`:
    - Allows specifying whether to download as a video or as an audio file; allows specifying the filename with a
      supported extension (providing an unsupported one will list the supported ones)
    - If downloading a video, the audio quality will always be the best ("best" as measured by the bitrate amount)
  - In `/playlist`:
    - For each video, the same options as in the above points
- Useful tooltips when hovering over certain buttons, notably individual downloads and the playlist download button

- Pop-up:
  - Options:
    - By default, whether to download a video in quality X/the highest available, or download according to the selected
      quality
    - Allow specifying a custom file extension for videos and audios

## To-dos (when I have time)

- Pop-up:
  - Options:
    - When initiating a download in a `/playlist` - by default whether to download the videos as a ZIP or as individual
      files
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
