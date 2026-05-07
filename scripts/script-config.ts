import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const home = homedir();

export const FFMPEG = join(home, "AppData", "Local", "Programs", "LNV", "Stremio-5", "ffmpeg.exe");
export const FFPROBE = join(home, "AppData", "Local", "Programs", "LNV", "Stremio-5", "ffprobe.exe");
export const DOWNLOADS = join(home, "Downloads");
export const TEMP_DIR = join(tmpdir(), "ytdl-verify");
