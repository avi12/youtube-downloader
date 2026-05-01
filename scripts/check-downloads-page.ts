// Reads the about:downloads tab and dumps the visible download entries.
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  console.log(`connecting to RDP port ${port}`);
  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs = await rdp.listTabs();
    const downloadsTab = tabs.find(tab => tab.url === "about:downloads");
    if (!downloadsTab) {
      console.log("no about:downloads tab");
      return;
    }

    const consoleActor = await rdp.getConsoleActor(downloadsTab.actor);
    if (!consoleActor) {
      throw new Error("no actor");
    }

    const result = await rdp.evalInTab(
      consoleActor, `(() => {
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
