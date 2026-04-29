import { buildSyntheticTemplateFromPlayer } from "./template-builder";

const POLL_INTERVAL_MS = 100;

export async function waitForTemplate({ timeoutMs }: { timeoutMs: number }) {
  const deadlineAt = Date.now() + timeoutMs;
  while (Date.now() < deadlineAt) {
    const template = window.__ytdlSabrTemplate;
    if (template) {
      return template;
    }

    const synthesized = buildSyntheticTemplateFromPlayer();
    if (synthesized) {
      window.__ytdlSabrTemplate = synthesized;
      return synthesized;
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("no SABR template captured within timeout");
}
