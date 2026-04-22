export {};

declare module "@ffmpeg/types" {
  interface FFmpegCoreModule {
    wasmBinary?: ArrayBuffer;
  }
}
