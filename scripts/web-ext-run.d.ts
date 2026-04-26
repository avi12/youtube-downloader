declare module "web-ext-run" {
  interface RunOptions {
    target: "firefox-desktop" | "chromium";
    sourceDir: string;
    startUrl?: string[];
    keepProfileChanges?: boolean;
    firefoxProfile?: string;
    firefox?: string;
    chromiumProfile?: string;
    args?: string[];
    customPrefs?: Record<string, unknown>;
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
