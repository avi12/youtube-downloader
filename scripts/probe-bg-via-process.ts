// Try alternate methods on WebExtensionDescriptor.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const addonsResp = await rdp.request("root", "listAddons");
    const addons: unknown[] = Array.isArray(addonsResp.addons) ? addonsResp.addons : [];
    const ytdl = addons.find(a => isRecord(a) && typeof a.name === "string" && a.name.includes("YouTube"));
    if (!isRecord(ytdl) || typeof ytdl.actor !== "string") {
      return;
    }

    const actor = ytdl.actor as string;

    // Try 'connect' / 'getWatcher' / etc.
    for (const method of ["connect", "getWatcher", "getAddon", "form"]) {
      try {
        const r = await rdp.request(actor, method);
        console.log(`${method}:`, JSON.stringify(r).slice(0, 400));
      } catch (e) {
        console.log(`${method}: err ${(e as Error).message?.slice(0, 100)}`);
      }
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
