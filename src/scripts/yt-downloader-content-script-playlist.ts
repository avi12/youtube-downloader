// import { getVideoData } from "./yt-downloader-functions";
// import {
//   gCancelControllers,
//   getIsDownloadable,
//   gPorts
// } from "./yt-downloader-content-script-initialize";
// import { isElementVisible } from "./utils";
// import Vue from "vue/dist/vue.js";

// function appendDownloadContainer({
//   videoId,
//   elVideoItem
// }: {
//   videoId: string;
//   elVideoItem: Element;
// }) {
//   const elDownloadContainer = document.createElement("div");
//   elDownloadContainer.dataset.ytdlDownloadContainer = videoId;
//   elVideoItem.append(elDownloadContainer);
// }
//
// function appendCheckbox({
//   videoId,
//   elVideoNumberContainer
// }: {
//   videoId: string;
//   elVideoNumberContainer: Element;
// }) {
//   const elCheckboxContainer = document.createElement("div");
//   elCheckboxContainer.className = "ytdl-playlist-checkbox-container";
//   elCheckboxContainer.style.width = "0";
//   elCheckboxContainer.innerHTML = `<input type="checkbox" data-ytdl-playlist-checkbox="${videoId}" />`;
//   elVideoNumberContainer.append(elCheckboxContainer);
//
//   setTimeout(() => {
//     elCheckboxContainer.style.width = "31px";
//   }, 500);
// }

export async function handlePlaylist(): Promise<void> {
  // const urlVideos = [...document.querySelectorAll("#video-title")].reduce(
  //   (urls, elTitle: HTMLAnchorElement) => {
  //     if (elTitle.offsetWidth > 0 && elTitle.offsetHeight > 0) {
  //       urls.push(elTitle.href);
  //     }
  //     return urls;
  //   },
  //   []
  // );
  //
  // const promiseHtmls = urlVideos.map(async url => {
  //   const abortController = new AbortController();
  //   gCancelControllers.push(abortController);
  //   const response = await fetch(url, { signal: abortController.signal });
  //   return response.text();
  // });
  //
  // const elVideoItems = [...document.querySelectorAll("#meta")].filter(
  //   isElementVisible
  // );
  // const elVideoNumbersContainers =
  //   document.querySelectorAll("#index-container");
  //
  // const downloadContainers: { [videoId: string]: Vue } = {};
  //
  // for (let i = 0; i < elVideoItems.length; i++) {
  //   const videoData = await getVideoData(await promiseHtmls[i]);
  //   if (!getIsDownloadable(videoData)) {
  //     continue;
  //   }
  //
  //   const { videoId } = videoData.videoDetails;
  //
  //   appendCheckbox({
  //     videoId,
  //     elVideoNumberContainer: elVideoNumbersContainers[i]
  //   });
  //   appendDownloadContainer({
  //     videoId,
  //     elVideoItem: elVideoItems[i]
  //   });
  //
  //   downloadContainers[videoId] = new Vue({
  //     el: `[data-ytdl-download-container="${videoId}"]`,
  //     data: {
  //       isStartedDownload: false,
  //       progress: 0
  //     },
  //     template: `
  //       <section class="ytdl-container">
  //       <div style="display: inline-block;">
  //         <button @click="toggleDownload">DOWNLOAD</button>
  //         <button>&centerdot;&centerdot;&centerdot;</button>
  //       </div>
  //       <progress :value="progress"></progress>
  //       </section>
  //     `,
  //     methods: {
  //       async toggleDownload() {
  //         this.isStartedDownload = !this.isStartedDownload;
  //
  //         if (!this.isStartedDownload) {
  //           gPorts.main.postMessage({ action: "cancel-download" });
  //           return;
  //         }
  //       }
  //     }
  //   });
  // }
}
