const DB_NAME = "ytdl-recent-downloads";
const DB_VERSION = 1;

export const Store = {
  Entries: "entries",
  Blobs: "blobs"
} as const;

let dbConnection: IDBDatabase | null = null;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result;
      if (!db.objectStoreNames.contains(Store.Entries)) {
        const store = db.createObjectStore(Store.Entries, { keyPath: "id" });
        store.createIndex("completedAt", "completedAt");
      }

      if (!db.objectStoreNames.contains(Store.Blobs)) {
        db.createObjectStore(Store.Blobs);
      }
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

export async function getDatabase() {
  if (dbConnection) {
    return dbConnection;
  }

  dbConnection = await openDatabase();
  dbConnection.onclose = () => {
    dbConnection = null;
  };
  return dbConnection;
}

export function awaitRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function awaitTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
