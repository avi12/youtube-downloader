/**
 * The contract between the dev server and a browser target (dev-chrome.ts, dev-firefox.ts): what a
 * target must be able to do, the code it evaluates inside the extension's own background (where the
 * tabs/scripting APIs live), and the one wording every target's outcome is logged in.
 *
 * Background code is kept as source strings: serializing a TS function would carry tsx's injected
 * helpers into a context that lacks them.
 */

import { REPLAY_FUNCTION_SOURCE } from "./dev-build-patches.ts";
import { describeContentScripts, ReloadKind, type ReloadPlan } from "./dev-output-changes.ts";

export type ExtensionReloadPlan = Extract<ReloadPlan, { kind: typeof ReloadKind.ReloadExtension }>;
export type PageRefreshPlan = Extract<ReloadPlan, { kind: typeof ReloadKind.RefreshPages }>;

export type TabUpdateResult = {
  reloadedTabCount: number;
  reinjectedTabCount: number;
  // One-shot MAIN-to-ISOLATED messages re-sent to the fresh scripts (dev-build-patches.ts)
  replayedHandshakeCount: number;
  fallbackReloads: {
    url: string;
    message: string;
  }[];
};

export const PageAction = {
  Reloaded: "reloaded",
  // A document the background owns (the offscreen document) - it recreates it on next use
  Closed: "closed - recreated on next use"
} as const;
type PageAction = (typeof PageAction)[keyof typeof PageAction];

export type RefreshedPage = {
  name: string;
  action: PageAction;
};

export type ReloadTarget = {
  // Reload the extension, re-run the ISOLATED content scripts in the open tabs in place and reload
  // only the tabs a changed MAIN-world script runs in
  reloadExtension: (plan: ExtensionReloadPlan) => Promise<TabUpdateResult>;
  // Refresh the open extension pages an HTML-only change touched, leaving the extension and tabs alone
  refreshPages: (plan: PageRefreshPlan) => Promise<RefreshedPage[]>;
};

const EXTENSION_API_SOURCE = "(globalThis.browser ?? globalThis.chrome)";

// Reload the tabs a changed MAIN-world script matches, then re-inject every ISOLATED script into the
// remaining complete, non-discarded tabs it matches and replay the handshakes it missed. A tab whose
// injection fails is reloaded instead, so it never keeps running an orphaned script.
export function buildTabUpdateSource({ mainWorldContentScripts, isolatedContentScripts }: Pick<ExtensionReloadPlan, "mainWorldContentScripts" | "isolatedContentScripts">) {
  const mainWorldPatterns = [...new Set(mainWorldContentScripts.flatMap(entry => entry.matches))];
  return `(async () => {
    const api = ${EXTENSION_API_SOURCE};
    const mainWorldPatterns = ${JSON.stringify(mainWorldPatterns)};
    const isolatedContentScripts = ${JSON.stringify(isolatedContentScripts)};
    const reloadedTabIds = new Set();
    const reinjectedTabIds = new Set();
    const fallbackReloadedTabIds = new Set();
    const fallbackReloads = [];
    if (mainWorldPatterns.length) {
      for (const tab of await api.tabs.query({ url: mainWorldPatterns })) {
        await api.tabs.reload(tab.id);
        reloadedTabIds.add(tab.id);
      }
    }

    for (const entry of isolatedContentScripts) {
      for (const tab of await api.tabs.query({ url: entry.matches, status: "complete" })) {
        if (tab.discarded || reloadedTabIds.has(tab.id) || fallbackReloadedTabIds.has(tab.id)) {
          continue;
        }

        const target = { tabId: tab.id, allFrames: entry.isAllFrames };
        try {
          if (entry.css.length) {
            // Drop the copy the previous hot-swap inserted (keyed by file) before adding the new one
            await api.scripting.removeCSS({ target, files: entry.css }).catch(() => {});
            await api.scripting.insertCSS({ target, files: entry.css });
          }

          await api.scripting.executeScript({ target, files: entry.js, world: "ISOLATED", injectImmediately: true });
          reinjectedTabIds.add(tab.id);
        } catch (error) {
          fallbackReloads.push({ url: tab.url, message: String(error?.message ?? error) });
          reinjectedTabIds.delete(tab.id);
          fallbackReloadedTabIds.add(tab.id);
          await api.tabs.reload(tab.id);
        }
      }
    }

    let replayedHandshakeCount = 0;
    for (const tabId of reinjectedTabIds) {
      const [injection] = await api.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: ${REPLAY_FUNCTION_SOURCE}
      }).catch(() => []);
      replayedHandshakeCount += injection?.result ?? 0;
    }

    return {
      reloadedTabCount: reloadedTabIds.size,
      reinjectedTabCount: reinjectedTabIds.size,
      replayedHandshakeCount,
      fallbackReloads
    };
  })()`;
}

// WXT's ContentScriptContext invalidates itself when a newer copy of the same content script
// announces itself on document with `${runtime.id}:${contentScriptName}${WXT_SCRIPT_STARTED_EVENT_SUFFIX}`
// - which unmounts every UI and runs every onInvalidated cleanup the script registered. Format:
// wxt/dist/utils/internal/custom-events.mjs (getUniqueEventName).
export const WXT_SCRIPT_STARTED_EVENT_SUFFIX = ":wxt:content-script-started";
export const WXT_SCRIPT_STARTED_MESSAGE_ID = "ytdl-dev-server";

export function describeExtensionReload({ plan, result }: {
  plan: ExtensionReloadPlan;
  result: TabUpdateResult;
}) {
  const fallbackMessages = [...new Set(result.fallbackReloads.map(reload => reload.message))];
  const outcomes = [
    {
      isShown: result.reinjectedTabCount > 0,
      text: `hot-swapped content script ${describeContentScripts(plan.isolatedContentScripts)} in ${result.reinjectedTabCount} tab(s), page state kept`
    },
    {
      isShown: result.replayedHandshakeCount > 0,
      text: `re-sent ${result.replayedHandshakeCount} download panel handshake(s)`
    },
    // The browser keeps the stylesheet a content script got at page load, and no API removes it
    {
      isShown: result.reinjectedTabCount > 0 && plan.changedIsolatedStyleSheets.length > 0,
      text: `CSS rules deleted from ${plan.changedIsolatedStyleSheets.join(", ")} since a tab was loaded stay applied in it until it reloads`
    },
    {
      isShown: result.reloadedTabCount > 0,
      text: `reloaded ${result.reloadedTabCount} tab(s) because MAIN-world content script ${describeContentScripts(plan.mainWorldContentScripts)} runs in the page itself and can't be swapped in place`
    },
    {
      isShown: fallbackMessages.length > 0,
      text: `reloaded ${result.fallbackReloads.length} tab(s) because in-place re-injection failed: ${fallbackMessages.join("; ")}`
    }
  ].filter(({ isShown }) => isShown).map(({ text }) => text);
  return [`Reloaded extension (${plan.reasons.join("; ")})`, ...outcomes.length ? outcomes : ["no open YouTube tabs to update"]].join(" - ");
}

export function describePageRefresh({ plan, refreshedPages }: {
  plan: PageRefreshPlan;
  refreshedPages: RefreshedPage[];
}) {
  const changedPages = [...plan.pageNames, ...plan.sharedAssetFiles].join(", ");
  if (!refreshedPages.length) {
    return `${changedPages} changed - none open, the next open loads the new build; extension and YouTube tabs untouched`;
  }

  const pageOutcomes = refreshedPages.map(page => `${page.name} ${page.action}`).join(", ");
  return `${changedPages} changed - ${pageOutcomes}; extension and YouTube tabs untouched`;
}
