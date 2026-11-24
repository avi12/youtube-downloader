// Shuts down the isolated worlds an extension reload orphaned in open tabs, from the outside over CDP
import { type CdpSession, type CdpTarget, openCdpSession, requireDebuggerUrl } from "#scripts/cdp-utils.ts";
import { WXT_SCRIPT_STARTED_EVENT_SUFFIX, WXT_SCRIPT_STARTED_MESSAGE_ID } from "#scripts/dev/browsers/reload-actions.ts";

const ISOLATED_WORLD_TYPE = "isolated";
// An isolated world whose extension was reloaded keeps running but loses its runtime id
const ORPHANED_WORLD_PROBE = "typeof chrome === \"undefined\" || !chrome.runtime?.id";
// DOMDebugger hands back listener functions only for objects that belong to an object group
const OBJECT_GROUP = "ytdl-dev-server";
const REMOVE_LISTENER_FUNCTION = "function (type, handler, useCapture) { this.removeEventListener(type, handler, useCapture); }";
// Calls an orphan's own WXT "newer script started" listener with the event it waits for. Dispatching
// the event instead would reach every world's listener, invalidating a live copy as well.
const INVOKE_SCRIPT_STARTED_LISTENER_FUNCTION = `function (handler, type, contentScriptName, messageId) {
  handler.call(this, new CustomEvent(type, { detail: { contentScriptName, messageId } }));
}`;

interface ExecutionContext {
  id: number;
  name?: string;
  auxData?: { type?: string };
}

interface RemoteObject { objectId?: string }

interface EventListenerInfo {
  type: string;
  useCapture: boolean;
  handler?: RemoteObject;
  originalHandler?: RemoteObject;
}

function handlerObjectIdOf({ originalHandler, handler }: EventListenerInfo) {
  return (originalHandler ?? handler)?.objectId;
}

async function listWorldListeners({ session, objectId }: {
  session: CdpSession;
  objectId: string;
}) {
  const { listeners } = await session.send<{ listeners: EventListenerInfo[] }>("DOMDebugger.getEventListeners", { objectId });
  return listeners.flatMap(listener => {
    const handlerObjectId = handlerObjectIdOf(listener);
    return handlerObjectId
      ? [{
        ...listener,
        handlerObjectId
      }]
      : [];
  });
}

// Invalidates the world's WXT content-script contexts, which unmounts every UI and runs every
// onInvalidated cleanup the scripts registered
async function invalidateWxtContexts({ session, objectId }: {
  session: CdpSession;
  objectId: string;
}) {
  const listeners = await listWorldListeners({
    session,
    objectId
  });
  for (const listener of listeners.filter(({ type }) => type.endsWith(WXT_SCRIPT_STARTED_EVENT_SUFFIX))) {
    const [, contentScriptName] = listener.type.split(":");
    await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: INVOKE_SCRIPT_STARTED_LISTENER_FUNCTION,
      arguments: [
        { objectId: listener.handlerObjectId },
        { value: listener.type },
        { value: contentScriptName },
        { value: WXT_SCRIPT_STARTED_MESSAGE_ID }
      ]
    });
  }
}

async function removeWorldListeners({ session, objectId }: {
  session: CdpSession;
  objectId: string;
}) {
  for (const listener of await listWorldListeners({
    session,
    objectId
  })) {
    await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: REMOVE_LISTENER_FUNCTION,
      arguments: [{ value: listener.type }, { objectId: listener.handlerObjectId }, { value: listener.useCapture }]
    });
  }
}

// Shut an orphaned world down from the outside: invalidate its WXT contexts, then remove every
// listener it still has on document and window, so it can't answer the page's cross-world messages
// alongside the fresh copy. DOMDebugger reports only the listeners whose handler lives in the
// queried object's own world, so the page's and the fresh copy's listeners are never touched.
async function neutralizeWorld({ session, contextId }: {
  session: CdpSession;
  contextId: number;
}) {
  for (const expression of ["document", "window"]) {
    const { result: { objectId } } = await session.send<{ result: RemoteObject }>("Runtime.evaluate", {
      expression,
      contextId,
      objectGroup: OBJECT_GROUP
    });
    if (!objectId) {
      continue;
    }

    await invalidateWxtContexts({
      session,
      objectId
    });
    await removeWorldListeners({
      session,
      objectId
    });
  }
}

export async function neutralizeOrphanedWorldsInPage({ page, worldName }: {
  page: CdpTarget;
  worldName: string;
}) {
  const session = await openCdpSession(requireDebuggerUrl(page));
  try {
    const contexts: ExecutionContext[] = [];
    session.on("Runtime.executionContextCreated", rawMessage => {
      const { params }: {
         params: { context: ExecutionContext } 
      } = JSON.parse(rawMessage);
      contexts.push(params.context);
    });
    await session.send("Runtime.enable");

    const extensionWorlds = contexts.filter(context =>
      context.auxData?.type === ISOLATED_WORLD_TYPE && context.name === worldName);
    for (const context of extensionWorlds) {
      const { result: probe } = await session.send<{
         result: { value?: boolean } 
      }>("Runtime.evaluate", {
        expression: ORPHANED_WORLD_PROBE,
        contextId: context.id,
        returnByValue: true
      });
      if (!probe.value) {
        continue;
      }

      await neutralizeWorld({
        session,
        contextId: context.id
      });
    }
  } finally {
    session.close();
  }
}
