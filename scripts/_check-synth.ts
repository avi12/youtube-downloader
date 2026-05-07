import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
const port = findFirefoxRdpPort();
const rdp = new RDP(port!);
await rdp.connect();
const res = await rdp.request("root", "listTabs");
const yt = (res.tabs as {url?:string,actor:string}[]).find(t => t.url?.includes("youtube.com/watch"));
const target = await rdp.request(yt!.actor, "getTarget");
const ca = (target.frame as {consoleActor:string}).consoleActor;
await rdp.request(ca, "startListeners", { listeners: ["PageError", "ConsoleAPI"] });
const result = await rdp.evalInTab(ca, `(function() {
  var synth = window.__ytdlSabr ? window.__ytdlSabr.synthesize() : null;
  var player = document.querySelector('#movie_player');
  var playerResp = null;
  try { playerResp = player ? player.getPlayerResponse() : null; } catch(e) { playerResp = 'err:' + e.message; }
  return JSON.stringify({
    synthResult: synth ? { url: synth.url.slice(0,80), bodyLen: synth.body.byteLength } : null,
    playerFound: !!player,
    hasGetPlayerResponse: player ? typeof player.getPlayerResponse : 'no player',
    playerRespHasSabrConfig: playerResp && typeof playerResp === 'object' ? !!playerResp.streamingData : false
  });
})()`);
console.log("SynthCheck:", result);
rdp.destroy();
