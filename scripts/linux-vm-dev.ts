/**
 * Daily runner: ensures the VM is up, refreshes the host port proxy in case
 * the VM IP changed, syncs the current Windows branch into the VM, and runs
 * scripts/dev-server.ts under Xvfb so Chrome binds CDP on 9233.
 *
 * Usage: pnpm dev:linux
 */

import { spawnSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const VM_NAME = "ytdl-linux";
const HOST_CDP_PORT = 9234;
const VM_CHROME_PORT = 9233;
const VM_SOCAT_PORT = 9235;
const VNC_PORT = 5900;
const VM_WORK_DIR = "/home/ubuntu/youtube-downloader";
const VNC_EXE = String.raw`C:\Program Files\RealVNC\VNC Viewer\vncviewer.exe`;

function capture(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return (result.stdout ?? "").trim();
}

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if ((result.status ?? 1) !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
}

const multipassCheck = spawnSync("multipass", ["version"], { stdio: "ignore" });
if (multipassCheck.error) {
  console.error("multipass not on PATH. Run scripts\\install-hyperv-multipass.ps1 first.");
  process.exit(1);
}

const infoRaw = capture("multipass", ["info", VM_NAME, "--format", "json"]);
if (!infoRaw) {
  console.error(`VM '${VM_NAME}' not found. Run: pnpm setup:linux-vm`);
  process.exit(1);
}

let info = JSON.parse(infoRaw);
if (info.info[VM_NAME].state !== "Running") {
  console.log(`Starting VM '${VM_NAME}'...`);
  run("multipass", ["start", VM_NAME]);
  info = JSON.parse(capture("multipass", ["info", VM_NAME, "--format", "json"]));
}

const vmIp: string = info.info[VM_NAME].ipv4[0];
console.log(`VM IP: ${vmIp}`);

const currentProxy = capture("netsh", ["interface", "portproxy", "show", "v4tov4"]);
const needCdpProxy = !new RegExp(`${vmIp}\\s+${VM_SOCAT_PORT}`).test(currentProxy);
const needVncProxy = !new RegExp(`${vmIp}\\s+${VNC_PORT}`).test(currentProxy);
if (needCdpProxy || needVncProxy) {
  console.log(`Refreshing portproxy (CDP 127.0.0.1:${HOST_CDP_PORT} -> ${vmIp}:${VM_SOCAT_PORT}, VNC 127.0.0.1:${VNC_PORT} -> ${vmIp}:${VNC_PORT})...`);
  const ps1 = join(tmpdir(), "portproxy-setup.ps1");
  writeFileSync(ps1, [
    `netsh interface portproxy delete v4tov4 listenport=${HOST_CDP_PORT} listenaddress=127.0.0.1`,
    `netsh interface portproxy delete v4tov4 listenport=${VNC_PORT} listenaddress=127.0.0.1`,
    `netsh interface portproxy add v4tov4 listenport=${HOST_CDP_PORT} listenaddress=127.0.0.1 connectport=${VM_SOCAT_PORT} connectaddress=${vmIp}`,
    `netsh interface portproxy add v4tov4 listenport=${VNC_PORT} listenaddress=127.0.0.1 connectport=${VNC_PORT} connectaddress=${vmIp}`,
  ].join("\r\n"));
  spawnSync("powershell", [
    "-c",
    `Start-Process powershell -Verb RunAs -Wait -ArgumentList ('-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', '${ps1.replace(/\\/g, "\\\\")}')`,
  ], { stdio: "inherit" });
  rmSync(ps1, { force: true });
}

console.log(`Ensuring socat bridge ${VM_SOCAT_PORT} -> 127.0.0.1:${VM_CHROME_PORT} inside VM...`);
spawnSync("multipass", ["exec", VM_NAME, "--", "bash", "-c",
  `if ! pgrep -fx 'socat TCP-LISTEN:${VM_SOCAT_PORT},reuseaddr,fork,bind=0.0.0.0 TCP:127.0.0.1:${VM_CHROME_PORT}' >/dev/null; then pgrep -x socat | xargs -r kill 2>/dev/null; nohup socat TCP-LISTEN:${VM_SOCAT_PORT},reuseaddr,fork,bind=0.0.0.0 TCP:127.0.0.1:${VM_CHROME_PORT} >/tmp/socat.log 2>&1 </dev/null & disown; fi`
], { stdio: "inherit" });

// Poll port 5900 then auto-open RealVNC Viewer (fires asynchronously while dev server streams)
function startVncPoller() {
  let attempts = 0;
  const poll = () => {
    if (attempts++ > 30) return;
    const socket = createConnection({ host: "127.0.0.1", port: VNC_PORT });
    socket.once("connect", () => {
      socket.destroy();
      spawn(VNC_EXE, [`localhost::${VNC_PORT}`], { detached: true, stdio: "ignore" }).unref();
    });
    socket.once("error", () => {
      socket.destroy();
      setTimeout(poll, 2000);
    });
  };
  setTimeout(poll, 15_000);
}
startVncPoller();

const branch = capture("git", ["-C", resolve(import.meta.dirname, ".."), "rev-parse", "--abbrev-ref", "HEAD"]);
console.log(`Syncing branch '${branch}' from host -> VM working tree...`);

// String.raw preserves backslashes so \K \S in grep patterns reach bash intact.
// ${...} interpolations still substitute TypeScript values; $VAR (no braces) stays as bash variables.
const syncScript = String.raw`set -euo pipefail
cd ${VM_WORK_DIR}
git fetch host
git reset --hard HEAD 2>/dev/null || true
git checkout -B '${branch}' host/'${branch}' 2>/dev/null || git checkout -B '${branch}' FETCH_HEAD
CI=true pnpm install --frozen-lockfile

# x11vnc supervisor: restart whenever Xvfb is up but x11vnc isn't running.
# set +e: ps/grep return 1 when Xvfb not yet up; must not kill the loop.
# disown: detach from bash job table so xvfb-run exit can't HUP it.
( set +e +o pipefail
  trap '' HUP
  while true; do
    XVFB_DISPLAY=$(ps -o args= -C Xvfb | awk 'NR==1{print $2}')
    XVFB_AUTH=$(ps -o args= -C Xvfb | grep -oP 'auth \K\S+' | head -1)
    if [ -n "$XVFB_DISPLAY" ] && [ -n "$XVFB_AUTH" ] && ! pgrep -x x11vnc >/dev/null 2>&1; then
      x11vnc -display "$XVFB_DISPLAY" -auth "$XVFB_AUTH" \
        -rfbport ${VNC_PORT} -listen 0.0.0.0 -nopw -forever -shared \
        -o /tmp/x11vnc.log 2>&1
    fi
    sleep 2
  done ) &
disown $!

pkill -f "[c]hrome-linux64" 2>/dev/null || true
sleep 1

echo 'Launching dev-server under xvfb-run...'
exec xvfb-run -a pnpm dev </dev/null
`;

// spawn (not spawnSync) so the event loop stays alive for the VNC poller
const proc = spawn("multipass", ["exec", VM_NAME, "--", "bash", "-c", syncScript], {
  stdio: "inherit"
});

proc.on("close", code => process.exit(code ?? 0));
