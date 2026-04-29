// Reads the about:downloads tab and dumps the visible download entries.
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  console.log(`connecting to RDP port ${port}`);
  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs: unknown[] = (await rdp.request("root", "listTabs")).tabs as unknown[];
    const dl = tabs.filter(isFirefoxTab).find(t => t.url === "about:downloads");
    if (!dl) {
      console.log("no about:downloads tab");
      return;
    }

    const target = await rdp.request(dl.actor, "getTarget");
    const frame = target.frame as Record<string, unknown>;
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
      throw new Error("no actor");
    }

    const result = await rdp.evalInTab(
      frame.consoleActor, `(() => {
      const items = Array.from(document.querySelectorAll('richlistitem'));
      return JSON.stringify(items.map(it => ({
        name: it.getAttribute('displayname') || it.querySelector('.downloadTarget')?.value || '(no name)',
        state: it.getAttribute('state'),
        progress: it.getAttribute('progress')
      })));
    })()`
    );
    console.log(`downloads: ${result}`);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
