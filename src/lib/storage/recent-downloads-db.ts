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
      const db = openRequest.result;
      const hasEntriesStore = db.objectStoreNames.contains(Store.Entries);
      if (!hasEntriesStore) {
        const store = db.createObjectStore(Store.Entries, { keyPath: "id" });
        store.createIndex("completedAt", "completedAt");
      }

      const hasBlobsStore = db.objectStoreNames.contains(Store.Blobs);
      if (!hasBlobsStore) {
        db.createObjectStore(Store.Blobs);
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

export async function addRecentDownload({ entry, blob }: {
  entry: {
    id: string;
    downloadId: number;
    videoId: string;
    title: string;
    channel: string;
    filename: string;
    container: string;
    mimeType: string;
    videoMimeType?: string;
    audioMimeType?: string;
    size: number;
    thumbnailUrl?: string;
    completedAt: number;
    lastActivityAt?: number;
    tabId?: number;
    quality?: string;
    sourceUrl?: string;
  };
  blob: Blob;
}) {
  // Persist entry+blob, evicting the oldest cached downloads to make room when
  // storage is full, so a new download always caches without overflowing the
  // disk. Returns false if it cannot fit even after evicting everything else.
  try {
    await putRecentDownload(entry, blob);
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

export type RecentDownloadEntry = Prettify<Parameters<typeof addRecentDownload>[0]["entry"]>;

async function putRecentDownload(entry: RecentDownloadEntry, blob: Blob) {
  const db = await getDatabase();
  const transaction = db.transaction([Store.Entries, Store.Blobs], "readwrite");
  transaction.objectStore(Store.Entries).put(entry);
  transaction.objectStore(Store.Blobs).put(blob, entry.id);
  await awaitTransaction(transaction);
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError";
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

async function mutateEntry(id: string, mutate: (entry: RecentDownloadEntry) => void) {
  const db = await getDatabase();
  const transaction = db.transaction(Store.Entries, "readwrite");
  const store = transaction.objectStore(Store.Entries);
  const entry: RecentDownloadEntry | undefined = await awaitRequest(store.get(id));
  if (entry) {
    mutate(entry);
    store.put(entry);
  }

  await awaitTransaction(transaction);
}

export async function touchRecentDownload(id: string) {
  await mutateEntry(id, entry => {
    entry.lastActivityAt = Date.now();
  });
}

// Resets every entry's retention clock to now, used when the popup closes so the
// 10-minute keep-alive window restarts from that moment.
export async function touchAllRecentDownloads() {
  const db = await getDatabase();
  const transaction = db.transaction(Store.Entries, "readwrite");
  const store = transaction.objectStore(Store.Entries);
  const now = Date.now();
  const cursorRequest = store.openCursor();

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }

    const entry: RecentDownloadEntry = cursor.value;
    entry.lastActivityAt = now;
    cursor.update(entry);
    cursor.continue();
  };

  await awaitTransaction(transaction);
}

export async function updateRecentDownloadId({ id, downloadId }: {
  id: string;
  downloadId: number;
}) {
  await mutateEntry(id, entry => {
    entry.downloadId = downloadId;
  });
}

export async function getAllRecentDownloads() {
  const db = await getDatabase();
  const transaction = db.transaction(Store.Entries, "readonly");
  const entries: RecentDownloadEntry[] = await awaitRequest(
    transaction.objectStore(Store.Entries).getAll()
  );
  return entries.toSorted((entryA, entryB) => entryB.completedAt - entryA.completedAt);
}

export async function getRecentDownloadBlob(id: string) {
  const db = await getDatabase();
  const transaction = db.transaction(Store.Blobs, "readonly");
  const blob = await awaitRequest(transaction.objectStore(Store.Blobs).get(id));
  return blob instanceof Blob ? blob : null;
}

export async function deleteRecentDownload(id: string) {
  const db = await getDatabase();
  const transaction = db.transaction([Store.Entries, Store.Blobs], "readwrite");
  transaction.objectStore(Store.Entries).delete(id);
  transaction.objectStore(Store.Blobs).delete(id);
  await awaitTransaction(transaction);
}

export async function pruneRecentDownloads({ olderThanTimestamp, protectedIds }: {
  olderThanTimestamp: number;
  protectedIds: ReadonlySet<string>;
}) {
  const db = await getDatabase();
  const transaction = db.transaction([Store.Entries, Store.Blobs], "readwrite");
  const entriesStore = transaction.objectStore(Store.Entries);
  const blobsStore = transaction.objectStore(Store.Blobs);
  const cursorRequest = entriesStore.openCursor();

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }

    const entry: RecentDownloadEntry = cursor.value;
    const youngestTimestamp = Math.max(entry.lastActivityAt ?? 0, entry.completedAt);
    const isEntryProtected = protectedIds.has(entry.id);
    if (youngestTimestamp <= olderThanTimestamp && !isEntryProtected) {
      entriesStore.delete(entry.id);
      blobsStore.delete(entry.id);
    }

    cursor.continue();
  };

  await awaitTransaction(transaction);
}
