declare module "web-ext-run" {
  interface RunOptions {
    target?: string;
    sourceDir?: string;
    startUrl?: string[];
    keepProfileChanges?: boolean;
    chromiumProfile?: string;
    firefoxProfile?: string;
    firefox?: string;
    args?: string[];
    customPrefs?: Record<string, unknown>;
    noReload?: boolean;
    noInput?: boolean;
  }

  interface Runner {
    reloadAllExtensions(): Promise<void>;
    exit(): Promise<void>;
  }

  const cmd: {
    run(options: RunOptions, meta?: { shouldExitProgram?: boolean }): Promise<Runner>;
  };

  export default { cmd };
}

declare module "web-ext-run/util/logger" {
  export const consoleStream: {
    write: (entry: { level: number; msg: string }) => void;
  };
}
