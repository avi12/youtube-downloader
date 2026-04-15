const DB_NAME = "ytdl-recent-downloads";
const DB_VERSION = 1;
const ENTRIES_STORE = "entries";
const BLOBS_STORE = "blobs";

let dbConnection: IDBDatabase | null = null;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result;
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        const store = db.createObjectStore(ENTRIES_STORE, { keyPath: "id" });
        store.createIndex("completedAt", "completedAt");
      }

      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE);
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
    size: number;
    thumbnailUrl?: string;
    completedAt: number;
  };
  blob: Blob;
}) {
  const db = await getDatabase();
  const transaction = db.transaction([ENTRIES_STORE, BLOBS_STORE], "readwrite");
  transaction.objectStore(ENTRIES_STORE).put(entry);
  transaction.objectStore(BLOBS_STORE).put(blob, entry.id);
  await awaitTransaction(transaction);
}

export type RecentDownloadEntry = Parameters<typeof addRecentDownload>[0]["entry"];

export async function getAllRecentDownloads() {
  const db = await getDatabase();
  const transaction = db.transaction(ENTRIES_STORE, "readonly");
  const entries: RecentDownloadEntry[] = await awaitRequest(
    transaction.objectStore(ENTRIES_STORE).getAll()
  );
  return entries.toSorted((entryA, entryB) => entryB.completedAt - entryA.completedAt);
}

export async function getRecentDownloadBlob(id: string) {
  const db = await getDatabase();
  const transaction = db.transaction(BLOBS_STORE, "readonly");
  const blob = await awaitRequest(transaction.objectStore(BLOBS_STORE).get(id));
  return blob instanceof Blob ? blob : null;
}

export async function deleteRecentDownload(id: string) {
  const db = await getDatabase();
  const transaction = db.transaction([ENTRIES_STORE, BLOBS_STORE], "readwrite");
  transaction.objectStore(ENTRIES_STORE).delete(id);
  transaction.objectStore(BLOBS_STORE).delete(id);
  await awaitTransaction(transaction);
}

export async function pruneRecentDownloads({ olderThanTimestamp, protectedIds }: {
  olderThanTimestamp: number;
  protectedIds: ReadonlySet<string>;
}) {
  const db = await getDatabase();
  const transaction = db.transaction([ENTRIES_STORE, BLOBS_STORE], "readwrite");
  const entriesStore = transaction.objectStore(ENTRIES_STORE);
  const blobsStore = transaction.objectStore(BLOBS_STORE);
  const index = entriesStore.index("completedAt");
  const cursorRequest = index.openCursor(IDBKeyRange.upperBound(olderThanTimestamp));

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }

    const entry: RecentDownloadEntry = cursor.value;
    if (!protectedIds.has(entry.id)) {
      entriesStore.delete(entry.id);
      blobsStore.delete(entry.id);
    }

    cursor.continue();
  };

  await awaitTransaction(transaction);
}
