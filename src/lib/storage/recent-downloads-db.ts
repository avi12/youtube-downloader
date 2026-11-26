import { isBlob, isDomException } from "@/lib/dom-guards";
import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";
import type { Prettify } from "@/types";

const DB_NAME = "ytdl-recent-downloads";
const DB_VERSION = 3;

const Store = {
  Entries: "entries",
  Blobs: "blobs"
} as const;

let dbConnection: IDBDatabase | null = null;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      const hasEntriesStore = database.objectStoreNames.contains(Store.Entries);
      if (!hasEntriesStore) {
        const store = database.createObjectStore(Store.Entries, { keyPath: "id" });
        store.createIndex("completedAt", "completedAt");
      }

      const hasBlobsStore = database.objectStoreNames.contains(Store.Blobs);
      if (!hasBlobsStore) {
        database.createObjectStore(Store.Blobs);
      }
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

async function getDatabase() {
  if (dbConnection) {
    return dbConnection;
  }

  dbConnection = await openDatabase();
  dbConnection.onclose = () => {
    dbConnection = null;
  };
  return dbConnection;
}

function awaitRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function awaitTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const recentDownloadEntrySchema = z.looseObject({
  id: z.string(),
  downloadId: z.number(),
  videoId: z.string(),
  title: z.string(),
  channel: z.string(),
  filename: z.string(),
  container: z.string(),
  mimeType: z.string(),
  videoMimeType: z.string().optional(),
  audioMimeType: z.string().optional(),
  size: z.number(),
  thumbnailUrl: z.string().optional(),
  completedAt: z.number(),
  lastActivityAt: z.number().optional(),
  tabId: z.number().optional(),
  quality: z.string().optional(),
  sourceUrl: z.string().optional(),
  // A duration that failed to parse is stored as NaN, which z.number() rejects
  lengthSeconds: z.number().or(z.nan()).optional()
});
const isRecentDownloadEntry = createGuard(recentDownloadEntrySchema);

export type RecentDownloadEntry = Prettify<z.infer<typeof recentDownloadEntrySchema>>;

export async function addRecentDownload({ entry, blob }: { entry: RecentDownloadEntry; blob: Blob }) {
  // Persist entry+blob, evicting the oldest cached downloads to make room when
  // storage is full, so a new download always caches without overflowing the
  // disk. Returns false if it cannot fit even after evicting everything else.
  try {
    await putRecentDownload({
       entry,
       blob 
    });
    return true;
  } catch (error) {
    if (!isQuotaExceeded(error)) {
      throw error;
    }

    const didEvict = await evictOldestRecentDownload(entry.id);
    if (!didEvict) {
      return false;
    }

    return addRecentDownload({
      entry,
      blob
    });
  }
}

async function putRecentDownload({ entry, blob }: { entry: RecentDownloadEntry; blob: Blob }) {
  const database = await getDatabase();
  const transaction = database.transaction([Store.Entries, Store.Blobs], "readwrite");
  transaction.objectStore(Store.Entries).put(entry);
  transaction.objectStore(Store.Blobs).put(blob, entry.id);
  await awaitTransaction(transaction);
}

function isQuotaExceeded(error: unknown) {
  return isDomException(error) && error.name === "QuotaExceededError";
}

function retentionTimestamp(entry: RecentDownloadEntry) {
  return Math.max(entry.lastActivityAt ?? 0, entry.completedAt);
}

async function evictOldestRecentDownload(excludeId: string) {
  const entries = await getAllRecentDownloads();
  const [oldest] = entries
    .filter(entry => entry.id !== excludeId)
    .toSorted((entryA, entryB) => retentionTimestamp(entryA) - retentionTimestamp(entryB));
  if (!oldest) {
    return false;
  }

  await deleteRecentDownload(oldest.id);
  return true;
}

async function mutateEntry({ id, mutate }: { id: string; mutate: (entry: RecentDownloadEntry) => void }) {
  const database = await getDatabase();
  const transaction = database.transaction(Store.Entries, "readwrite");
  const store = transaction.objectStore(Store.Entries);
  const entry: unknown = await awaitRequest(store.get(id));
  if (isRecentDownloadEntry(entry)) {
    mutate(entry);
    store.put(entry);
  }

  await awaitTransaction(transaction);
}

export async function touchRecentDownload(id: string) {
  await mutateEntry({
 id,
     mutate(entry) {
    entry.lastActivityAt = Date.now();
  } 
});
}

// Resets every entry's retention clock to now, used when the popup closes so the
// 10-minute keep-alive window restarts from that moment.
export async function touchAllRecentDownloads() {
  const database = await getDatabase();
  const transaction = database.transaction(Store.Entries, "readwrite");
  const store = transaction.objectStore(Store.Entries);
  const now = Date.now();
  const cursorRequest = store.openCursor();

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }

    const entry: unknown = cursor.value;
    if (isRecentDownloadEntry(entry)) {
      entry.lastActivityAt = now;
      cursor.update(entry);
    }

    cursor.continue();
  };

  await awaitTransaction(transaction);
}

export async function updateRecentDownloadId({ id, downloadId }: {
  id: string;
  downloadId: number;
}) {
  await mutateEntry({
 id,
     mutate(entry) {
    entry.downloadId = downloadId;
  } 
});
}

export async function getAllRecentDownloads() {
  const database = await getDatabase();
  const transaction = database.transaction(Store.Entries, "readonly");
  const entries = await awaitRequest(transaction.objectStore(Store.Entries).getAll());
  return entries.filter(isRecentDownloadEntry).toSorted((entryA, entryB) => entryB.completedAt - entryA.completedAt);
}

export async function getRecentDownloadBlob(id: string) {
  const database = await getDatabase();
  const transaction = database.transaction(Store.Blobs, "readonly");
  const blob = await awaitRequest(transaction.objectStore(Store.Blobs).get(id));
  return isBlob(blob) ? blob : null;
}

export async function deleteRecentDownload(id: string) {
  const database = await getDatabase();
  const transaction = database.transaction([Store.Entries, Store.Blobs], "readwrite");
  transaction.objectStore(Store.Entries).delete(id);
  transaction.objectStore(Store.Blobs).delete(id);
  await awaitTransaction(transaction);
}

export async function pruneRecentDownloads({ olderThanTimestamp, protectedIds }: {
  olderThanTimestamp: number;
  protectedIds: ReadonlySet<string>;
}) {
  const database = await getDatabase();
  const transaction = database.transaction([Store.Entries, Store.Blobs], "readwrite");
  const entriesStore = transaction.objectStore(Store.Entries);
  const blobsStore = transaction.objectStore(Store.Blobs);
  const cursorRequest = entriesStore.openCursor();

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }

    const entry: unknown = cursor.value;
    if (!isRecentDownloadEntry(entry)) {
      cursor.continue();
      return;
    }

    const youngestTimestamp = Math.max(entry.lastActivityAt ?? 0, entry.completedAt);
    const isEntryProtected = protectedIds.has(entry.id);
    const isExpired = youngestTimestamp <= olderThanTimestamp && !isEntryProtected;
    if (isExpired) {
      entriesStore.delete(entry.id);
      blobsStore.delete(entry.id);
    }

    cursor.continue();
  };

  await awaitTransaction(transaction);
}
