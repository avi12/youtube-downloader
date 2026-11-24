// Keeps WXT loaded between dev rebuilds: a cold `wxt build` spends about two seconds starting Node and
// loading WXT and Vite before it bundles anything. One JSON build request arrives per stdin line, and
// one result line goes back. WXT writes its progress to stdout, so that is rerouted to stderr and the
// result lines use the saved original.
import { createInterface } from "node:readline";
import { build } from "wxt";

const writeResult = process.stdout.write.bind(process.stdout);
process.stdout.write = (...parts) => process.stderr.write(...parts);
console.log = console.error;

async function runBuild({ root, browser, configFile }) {
  try {
    await build({
       root,
       browser,
       ...configFile ? { configFile } : {} 
    });
    return { type: "done" };
  } catch (error) {
    return {
       type: "failed",
       message: String(error?.stack ?? error) 
    };
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  writeResult(`${JSON.stringify(await runBuild(JSON.parse(line)))}\n`);
}
