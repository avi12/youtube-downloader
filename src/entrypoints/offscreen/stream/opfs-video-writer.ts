const VIDEO_STREAM_SUFFIX = "-video-stream";

export class OPFSVideoWriter {
  private writable: FileSystemWritableFileStream | null = null;
  private writeQueue: Promise<void>;
  private handle: FileSystemFileHandle | null = null;

  constructor(videoId: string) {
    this.writeQueue = (async () => {
      const root = await navigator.storage.getDirectory();
      this.handle = await root.getFileHandle(videoId + VIDEO_STREAM_SUFFIX, { create: true });
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

  static async cleanup(videoId: string) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(videoId + VIDEO_STREAM_SUFFIX);
    } catch { /* no-op */ }
  }
}
