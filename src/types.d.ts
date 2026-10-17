import "@ffmpeg/types";

declare module "@ffmpeg/types" {
  interface FS {
    open(path: string, flags: string): unknown;
    write(stream: unknown, buffer: Uint8Array, offset: number, length: number): number;
    close(stream: unknown): void;
  }
}
