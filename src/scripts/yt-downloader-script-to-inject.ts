// @ts-ignore
var { raw_player_response } = ytplayer.config.args;
document.documentElement.dataset.playerResponse = JSON.stringify(
  raw_player_response
);

// @ts-ignore
var { STS, PLAYER_JS_URL } = ytcfg.data_;
document.documentElement.dataset.ytcfg = JSON.stringify({ STS, PLAYER_JS_URL });
