declare module "web-ext-run" {
  interface RunOptions {
    target: "firefox-desktop" | "chromium";
    sourceDir: string;
    startUrl?: string[];
    keepProfileChanges?: boolean;
    firefoxProfile?: string;
    chromiumProfile?: string;
    args?: string[];
    noReload?: boolean;
    noInput?: boolean;
  }

  interface RunResult {
    reloadAllExtensions(): Promise<void>;
    exit(): Promise<void>;
  }

  const webExt: {
    cmd: {
      run(options: RunOptions, meta: { shouldExitProgram: boolean }): Promise<RunResult>;
    };
  };

  export default webExt;
}

declare module "web-ext-run/util/logger" {
  interface LogEntry {
    level: number;
    msg: string;
    name: string;
  }

  export const consoleStream: {
    write: (entry: LogEntry) => void;
  };
}
