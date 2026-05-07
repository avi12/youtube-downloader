declare module "@ffmpeg/core" {
  import type { FFmpegCoreModuleFactory } from "@ffmpeg/types";
  const createFFmpegCore: FFmpegCoreModuleFactory;
  export default createFFmpegCore;
}
