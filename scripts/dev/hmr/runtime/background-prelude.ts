/**
 * Dev-only prelude the dev server prepends to the built background script (output/patches.ts), so the
 * background can restart in place without reloading the extension (browsers/background-swap.ts):
 *
 *  - on first run it records everything the background registers: extension event listeners (every
 *    `on*` event of every API namespace), the ports other contexts connect to it, global event
 *    listeners and timers
 *  - when the dev server evaluates the rebuilt script in the running background, this prelude runs
 *    first, finds the registry and tears the previous copy down - listeners removed, ports
 *    disconnected, timers cleared - so the new copy starts exactly like a background that was
 *    suspended and woken, which every MV3 background must already handle
 *
 * The content scripts and extension pages stay connected to the same extension, so nothing is
 * orphaned and no tab reloads.
 */

type Listener = (...args: unknown[]) => unknown;

interface ExtensionEvent {
  addListener: (listener: Listener, ...extra: unknown[]) => void;
  removeListener: (listener: Listener) => void;
}

interface ConnectedPort {
  disconnect: () => void;
}

interface GlobalListener {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | EventListenerOptions;
}

const CONNECT_EVENT_NAMES = new Set(["onConnect", "onConnectExternal"]);
const EVENT_NAME = /^on[A-Z]/;
// chrome.storage.local.onChanged and friends sit one namespace deeper
const MAX_NAMESPACE_DEPTH = 2;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExtensionEvent(value: unknown): value is ExtensionEvent {
  return isObject(value) && typeof value.addListener === "function" && typeof value.removeListener === "function";
}

function isConnectedPort(value: unknown): value is ConnectedPort {
  return isObject(value) && typeof value.disconnect === "function";
}

// A getter of a namespace the extension has no permission for throws
function readProperty({ owner, key }: { owner: Record<string, unknown>; key: string }) {
  try {
    return owner[key];
  } catch {
    return undefined;
  }
}

function collectEvents({ namespace, depth, events }: {
  namespace: Record<string, unknown>;
  depth: number;
  events: Map<ExtensionEvent, string>;
}) {
  for (const key of Object.keys(namespace)) {
    const value = readProperty({
      owner: namespace,
      key
    });
    const isEvent = EVENT_NAME.test(key) && isExtensionEvent(value);
    if (isEvent) {
      events.set(value, key);
      continue;
    }

    const isNestedNamespace = depth < MAX_NAMESPACE_DEPTH && isObject(value);
    if (isNestedNamespace) {
      collectEvents({
        namespace: value,
        depth: depth + 1,
        events
      });
    }
  }
}

function createRegistry() {
  const registrations = new Set<{
    event: ExtensionEvent;
    listener: Listener;
    registered: Listener;
    removeListener: (listener: Listener) => void;
  }>();
  const ports = new Set<ConnectedPort>();
  const globalListeners = new Set<GlobalListener>();
  const timers = new Set<Parameters<typeof clearTimeout>[0]>();

  // A port opened to this background belongs to the copy that accepted it, so a swap disconnects it
  // the way a suspended background would, and the other side reconnects to the new copy
  function trackPorts(listener: Listener) {
    return (...args: unknown[]) => {
      const [port] = args;
      if (isConnectedPort(port)) {
        ports.add(port);
      }

      return listener(...args);
    };
  }

  const events = new Map<ExtensionEvent, string>();
  for (const api of new Set([globalThis.chrome, globalThis.browser])) {
    if (isObject(api)) {
      collectEvents({
        namespace: api,
        depth: 1,
        events
      });
    }
  }

  for (const [event, name] of events) {
    const addListener = event.addListener.bind(event);
    const removeListener = event.removeListener.bind(event);
    event.addListener = (listener, ...extra) => {
      const registered = CONNECT_EVENT_NAMES.has(name) ? trackPorts(listener) : listener;
      registrations.add({
        event,
        listener,
        registered,
        removeListener
      });
      addListener(registered, ...extra);
    };
    event.removeListener = listener => {
      const registration = [...registrations].find(entry => entry.event === event && entry.listener === listener);
      removeListener(registration?.registered ?? listener);

      if (registration) {
        registrations.delete(registration);
      }
    };
  }

  const addEventListener = globalThis.addEventListener.bind(globalThis);
  function trackGlobalListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!listener) {
      return;
    }

    globalListeners.add({
      type,
      listener,
      options
    });
    addEventListener(type, listener, options);
  }

  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeSetInterval = globalThis.setInterval.bind(globalThis);
  function trackTimer<TTimer extends Parameters<typeof clearTimeout>[0]>(timer: TTimer) {
    timers.add(timer);
    return timer;
  }

  // Object.assign, because the DOM and Node typings of these globals disagree on their overloads
  Object.assign(globalThis, {
    addEventListener: trackGlobalListener,
    setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => trackTimer(nativeSetTimeout(handler, timeout, ...args)),
    setInterval: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => trackTimer(nativeSetInterval(handler, timeout, ...args))
  });

  // Resolves to how many registrations it undid, for the dev server's log
  function teardown() {
    const count = registrations.size + ports.size + globalListeners.size;
    for (const { registered, removeListener } of registrations) {
      removeListener(registered);
    }

    for (const port of ports) {
      port.disconnect();
    }

    for (const { type, listener, options } of globalListeners) {
      globalThis.removeEventListener(type, listener, options);
    }

    for (const timer of timers) {
      clearTimeout(timer);
    }

    registrations.clear();
    ports.clear();
    globalListeners.clear();
    timers.clear();
    return count;
  }

  return { teardown };
}

const previousBackground = globalThis.ytdlDevBackground;
if (previousBackground) {
  console.info(`[YTDL HMR] background restarting in place - undid ${previousBackground.teardown()} registrations`);
}

globalThis.ytdlDevBackground = previousBackground ?? createRegistry();
