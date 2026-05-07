const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const VISITOR_DATA = "Cgs2YVM5WDdWOFc0TSiYhejPBjIKCgJJTBIEGgAgNWLfAgrcAjE4LllUPXdLeHNyczY5QXYyOFVLZi1a";

// Latest URL from the test
const cdnUrl = "https://rr4---sn-nhpax-ua8r.googlevideo.com/videoplayback?expire=1778013955&ei=owL6abSPMN-izPsPtOPrwAM&ip=87.68.192.96&id=o-AF1s6LAme99VhKmjKs9Pv8yexVnH3ulCait12ReqcJoJ&itag=140&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ%3D%3D&cps=662&met=1777992355%2C&mh=Un&mm=31%2C29&mn=sn-nhpax-ua8r%2Csn-4g5ednse&ms=au%2Crdu&mv=m&mvi=4&pl=19&rms=au%2Cau&initcwndbps=1563750&bui=AbKmrwo2nGh2a7H8nuFixFgVYY1-QNXlww2JtpnpFGOBAcE6aSuTxRVJOrhskWjjHGhmuIN-0zdg2HOa&spc=96Xrv8WxLa_FhRY8bRLffDmzwHiN_It3F1402tN1AlacM_CTsikBEcYtiPF0tQ&vprv=1&svpuc=1&mime=audio%2Fmp4&rqh=1&gir=yes&clen=11235399&dur=694.183&lmt=17777472";

async function test(label: string, headers: Record<string, string>) {
  const r = await fetch(cdnUrl, { headers: { Range: "bytes=0-999", ...headers } });
  console.log(label, "status:", r.status, "ct:", r.headers.get("content-type")?.slice(0, 30));
}

await test("bare", {});
await test("chrome-ua", { "User-Agent": CHROME_UA });
await test("visitor-id", { "X-Goog-Visitor-Id": VISITOR_DATA });
await test("ua+visitor-id", { "User-Agent": CHROME_UA, "X-Goog-Visitor-Id": VISITOR_DATA });
await test("origin-yt", { "Origin": "https://www.youtube.com" });
await test("referer-yt", { "Referer": "https://www.youtube.com/" });
