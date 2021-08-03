// noinspection ES6ConvertVarToLetConst
// eslint-disable-next-line
var gMapQualities = {
  tiny: 144,
  small: 240,
  medium: 360,
  large: 480
};

// https://developers.google.com/youtube/iframe_api_reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function onYouTubePlayerReady(player) {
  storePlaybackQuality(player.getPlaybackQuality());
  player.addEventListener("onPlaybackQualityChange", storePlaybackQuality);
}

function storePlaybackQuality(quality) {
  quality = gMapQualities[quality] || quality;
  document.querySelector("video").dataset.ytDownloaderCurrentQuality = quality
    .toString()
    .match(/\d+/)[0];
}
