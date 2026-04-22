declare module "@ffmpeg/core" {
  const createFFmpegCore: import("@ffmpeg/types").FFmpegCoreModuleFactory;
  export default createFFmpegCore;
}
