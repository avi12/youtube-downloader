import { OPFS_VIDEO_STREAM_SUFFIX } from "@/lib/download-pipeline/opfs-constants";

export class OPFSVideoWriter {
  private writable: FileSystemWritableFileStream | null = null;
  private writeQueue: Promise<void>;
  private handle: FileSystemFileHandle | null = null;

  constructor(videoId: string) {
    this.writeQueue = (async () => {
      const root = await navigator.storage.getDirectory();
      this.handle = await root.getFileHandle(videoId + OPFS_VIDEO_STREAM_SUFFIX, { create: true });
      this.writable = await this.handle.createWritable();
    })();
  }

  enqueueChunk(chunk: Uint8Array) {
    const owned = chunk.slice();
    this.writeQueue = this.writeQueue.then(() => this.writable!.write(owned));
  }

  async close() {
    await this.writeQueue;
    await this.writable!.close();
    return this.handle!;
  }
}
