# YouTube Downloader

A browser extension for downloading videos from YouTube

Made by [avi12](https://avi12.com)

## This is a WIP

Still in development, for as long as I'm not 100% happy with the result

## Features

- Download videos from `/watch` & `/playlist`
- Viewing the download progress
- All downloads are cancelable
- In videos on `/watch`:
  - If the video isn't in the "Music" category, clicking Download will by default download the video in the currently-selected
    quality as MP4, unless specified otherwise in the rich options modal (see below)
  - Otherwise, by default, it will be downloaded as an MP3
- In playlists on `/playlist`:
  - When clicking on an individual video (i.e. clicking Download on a video):
    - If the video isn't in the "Music" category, by default, it will start downloading and make the other videos queue up
    - Otherwise, by default, it will start downloading immediately as an audio file, unless specified otherwise in the rich options (see below)
  - When selecting multiple videos and clicking the Download button that's tied to the playlist
    - For any video that are video + audio, they will download one-by-one
    - For any music videos, unless specified otherwise in the rich options (see below), they will download as MP3s in parallel (be careful with your bandwidth)
- Pop-up page:
  - Videos that download as video + audio can be reordered
  - Videos' downloads can be canceled, including music ones and audio-less video ones (individually and multiple)
- Rich options:
  - In `/watch`:
    - Allows specifying whether to download the video as a video or as an audio file; allows specifying the filename with a supported extension (providing an unsupported one will list the supported ones)
    - If downloading a video, the audio quality will always be the best ("best" as measured by the bitrate amount)
  - In `/playlist`:
    - For each video, the same options as in the above points

## To-dos

- Pop-up:
  - Options:
    - When initiating a download in a `/playlist` - by default whether to download the videos as a ZIP or as individual files
    - By default, whether to download a video in quality X/the highest available, or download according to the selected
      quality
    - Allow specifying a custom file extension for videos and audios
- If the video has Clip, opening the Clip modal will allow specifying which portion of the video to download (including
  the rich options, as mentioned above)

## Installation

1. To get the latest version, use **one** of the links: [AdFly](http://fumacrom.com/3907988/youtube-downloader),
   [Linkshrink](https://linkshrink.ca/youtube-downloader),
   [AdPayLink](https://go.rancah.com/7hRX),
   or [direct](https://bit.ly/3tqf9y6)
2. If on Chrome or Edge:
   1. Go to the extensions page
   2. Enable "Developer mode" (top-right corner usually)
   3. Drag & drop the ZIP onto the extensions page
3. If on Opera: 2. Go to the extensions page 3. Extract the ZIP into a folder 4. "Load unpacked" → select that folder
4. If on Firefox: [follow this guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
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
