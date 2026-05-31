/**
 * cherry-pick-loop.mjs
 *
 * Cherry-picks a list of commit SHAs onto the current branch, one at a time.
 * Between picks: stashes WIP, cherry-picks, pops stash, waits for the dev
 * server to rebuild, then runs scripts/verify-download.mjs.
 *
 * Halts on first failure (conflict OR download verify failure) so the user
 * can triage from a known checkpoint.
 *
 * Usage:
 *   node scripts/cherry-pick-loop.mjs <commitsFile> [port] [timeoutSec]
 *   commitsFile: one SHA per line, '#' lines ignored
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const COMMITS_FILE = process.argv[2];
const PORT = process.argv[3] ?? "9229";
const VERIFY_TIMEOUT = process.argv[4] ?? "240";
const LOG_FILE = "scripts/cherry-pick-loop.log";

const STASH_MSG = "cherry-pick-loop wip auto-stash";
const REBUILD_WAIT_MS = 9000;

if (!COMMITS_FILE || !existsSync(COMMITS_FILE)) {
  console.error("commits file missing:", COMMITS_FILE);
  process.exit(2);
}

const commits = readFileSync(COMMITS_FILE, "utf8")
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith("#"))
  .map(line => line.split(/\s+/)[0]);

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { stdout: r.stdout?.trim() ?? "", stderr: r.stderr?.trim() ?? "", status: r.status };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try { writeFileSync(LOG_FILE, stamped + "\n", { flag: "a" }); } catch {}
}

function hasWipChanges() {
  return git("status", "--porcelain", "-uno").stdout.length > 0;
}

function stashWip() {
  if (!hasWipChanges()) return { stashed: false };
  const r = git("stash", "push", "-m", STASH_MSG);
  return { stashed: r.status === 0, output: r.stdout + r.stderr };
}

function popWip() {
  const list = git("stash", "list").stdout;
  const matches = list.split("\n").some(l => l.includes(STASH_MSG));
  if (!matches) return { popped: false, conflict: false };
  const r = git("stash", "pop");
  return { popped: r.status === 0, conflict: /conflict/i.test(r.stderr + r.stdout), output: r.stdout + r.stderr };
}

function abortCherry() {
  git("cherry-pick", "--abort");
}

async function reloadYt() {
  return new Promise(res => {
    spawnSync("node", ["scripts/reload-yt.mjs", PORT], { stdio: "inherit" });
    res(null);
  });
}

function runVerify() {
  const r = spawnSync("node", ["scripts/verify-download.mjs", PORT, VERIFY_TIMEOUT], {
    encoding: "utf8"
  });
  return { stdout: r.stdout?.trim() ?? "", stderr: r.stderr?.trim() ?? "", status: r.status };
}

(async () => {
  log(`starting cherry-pick loop: ${commits.length} commits`);
  log(`branch: ${git("rev-parse", "--abbrev-ref", "HEAD").stdout}`);
  let index = 0;
  const results = [];
  for (const sha of commits) {
    index++;
    const subject = git("log", "-1", "--format=%s", sha).stdout;
    log(`---`);
    log(`[${index}/${commits.length}] ${sha} ${subject}`);

    const stash = stashWip();
    if (stash.stashed) log("stashed WIP");

    const cp = git("cherry-pick", sha);
    if (cp.status !== 0) {
      log(`cherry-pick CONFLICT, skipping: ${cp.stderr.split("\n")[0]}`);
      abortCherry();
      const pop = popWip();
      if (!pop.popped && stash.stashed) log("WARNING: stash pop failed after abort");
      results.push({ sha, subject, outcome: "skipped-conflict", detail: cp.stderr.split("\n").slice(0, 5).join(" | ") });
      writeFileSync("scripts/cherry-pick-loop.results.json", JSON.stringify(results, null, 2));
      continue;
    }

    const pop = popWip();
    if (!pop.popped && stash.stashed) {
      log(`stash pop FAILED (conflict=${pop.conflict})`);
      results.push({ sha, subject, outcome: "pop-conflict", detail: pop.output });
      log("HALTING for triage");
      writeFileSync("scripts/cherry-pick-loop.results.json", JSON.stringify(results, null, 2));
      process.exit(1);
    }

    log(`waiting ${REBUILD_WAIT_MS}ms for dev-server rebuild...`);
    await sleep(REBUILD_WAIT_MS);
    await reloadYt();
    await sleep(2500);

    log("running verify-download...");
    const verify = runVerify();
    log(`verify stdout: ${verify.stdout}`);
    if (verify.status !== 0) {
      log(`verify FAILED for ${sha} - reverting commit`);
      results.push({ sha, subject, outcome: "verify-failed-reverted", verify: verify.stdout });
      // Drop the just-cherry-picked commit so the branch stays at last-known-good
      const stashAgain = stashWip();
      const reset = git("reset", "--hard", "HEAD~1");
      if (reset.status !== 0) log(`reset FAILED: ${reset.stderr}`);
      if (stashAgain.stashed) popWip();
      writeFileSync("scripts/cherry-pick-loop.results.json", JSON.stringify(results, null, 2));
      continue;
    }
    results.push({ sha, subject, outcome: "ok", verify: verify.stdout });
    writeFileSync("scripts/cherry-pick-loop.results.json", JSON.stringify(results, null, 2));
  }
  log(`DONE - all ${commits.length} commits cherry-picked and verified`);
  writeFileSync("scripts/cherry-pick-loop.results.json", JSON.stringify(results, null, 2));
})().catch(e => {
  log(`ERROR: ${e.stack ?? e.message}`);
  process.exit(2);
});
