import { Store, awaitRequest, awaitTransaction, getDatabase } from "./recent-downloads-db-connection";

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
  };
  blob: Blob;
}) {
  const db = await getDatabase();
  const transaction = db.transaction([Store.Entries, Store.Blobs], "readwrite");
  transaction.objectStore(Store.Entries).put(entry);
  transaction.objectStore(Store.Blobs).put(blob, entry.id);
  await awaitTransaction(transaction);
}

export type RecentDownloadEntry = Parameters<typeof addRecentDownload>[0]["entry"];

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
