// Force-reload the extension via Firefox's RDP AddonsActor (same mechanism
// web-ext-run uses for hot reload). Discovers the addon's actor by listing
// installed addons, then sends `reload` to it.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

const ADDON_ID = "youtube-downloader@avi12.com";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const root = await rdp.request("root", "getRoot");
    const addonsActor = isRecord(root) ? root.addonsActor : null;
    if (typeof addonsActor !== "string") {
      throw new Error(`no addonsActor on root: ${JSON.stringify(root).slice(0, 300)}`);
    }

    console.log(`addonsActor=${addonsActor}`);
    const list = await rdp.request("root", "listAddons") as Record<string, unknown>;
    const addons = Array.isArray(list.addons) ? list.addons : [];
    const addon = addons.filter(isRecord).find(a => a.id === ADDON_ID);
    if (!addon) {
      throw new Error(`addon not found; installed: ${addons.map(a => isRecord(a) ? a.id : "?").join(", ")}`);
    }

    console.log(`addon: id=${addon.id} actor=${addon.actor} debuggable=${addon.debuggable}`);

    const actor = isRecord(addon) && typeof addon.actor === "string" ? addon.actor : "";
    if (!actor) {
      throw new Error("no addon actor");
    }

    const reloadResult = await rdp.request(actor, "reload");
    console.log(`reload: ${JSON.stringify(reloadResult)}`);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
