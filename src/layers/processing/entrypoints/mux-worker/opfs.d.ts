// FileSystemSyncAccessHandle is defined in lib.webworker.d.ts, not lib.dom.d.ts.
// Declaring it here so non-worker TypeScript contexts can type-check files that reference it.

interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: FileSystemReadWriteOptions): number;
  write(buffer: ArrayBufferView, options?: FileSystemReadWriteOptions): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface FileSystemReadWriteOptions {
  at?: number;
}

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}
