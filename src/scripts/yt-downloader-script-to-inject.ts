// @ts-ignore
var { raw_player_response } = ytplayer.config.args;
document.documentElement.dataset.videoTitle =
  raw_player_response?.microformat?.playerMicroformatRenderer?.title
    ?.simpleText ?? "";

var { adaptiveFormats } = raw_player_response?.streamingData;
document.documentElement.dataset.adaptiveFormats = JSON.stringify(
  adaptiveFormats
);

// @ts-ignore
var { STS, PLAYER_JS_URL } = ytcfg.data_;
document.documentElement.dataset.ytcfg = JSON.stringify({ STS, PLAYER_JS_URL });
