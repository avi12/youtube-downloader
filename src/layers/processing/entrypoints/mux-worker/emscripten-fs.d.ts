// Augments @ffmpeg/types with Emscripten FS internals not in the official type definitions.

// Emscripten FS stream and node types used by custom filesystem drivers.
export interface EmscriptenFsNode {
  name: string;
  mode: number;
  parent: EmscriptenFsNode;
  timestamp: number;
  id: number;
  contents: Record<string, EmscriptenFsNode> | Uint8Array | null;
  node_ops: EmscriptenNodeOps;
  stream_ops: EmscriptenStreamOps;
  syncHandle?: FileSystemSyncAccessHandle | null;
  fileSize?: number;
  [key: string]: unknown;
}

export interface EmscriptenFsStream {
  node: EmscriptenFsNode;
  fd: number;
  position: number;
  flags: number;
  [key: string]: unknown;
}

export type EmscriptenNodeOps = {
  getattr?: (node: EmscriptenFsNode) => {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    blksize: number;
    blocks: number;
  };
  setattr?: (node: EmscriptenFsNode, attr: Partial<{
    mode: number;
    timestamp: number;
    size: number;
  }>) => void;
  readdir?: (node: EmscriptenFsNode) => string[];
  lookup?: (parent: EmscriptenFsNode, name: string) => EmscriptenFsNode;
  mknod?: (parent: EmscriptenFsNode, name: string, mode: number, dev: number) => EmscriptenFsNode;
  rename?: (oldNode: EmscriptenFsNode, newDir: EmscriptenFsNode, newName: string) => void;
  unlink?: (parent: EmscriptenFsNode, name: string) => void;
  rmdir?: (parent: EmscriptenFsNode, name: string) => void;
};

export type EmscriptenStreamOps = {
  open?: (stream: EmscriptenFsStream) => void;
  close?: (stream: EmscriptenFsStream) => void;
  read?: (stream: EmscriptenFsStream, buffer: Uint8Array, offset: number, length: number, position: number) => number;
  write?: (stream: EmscriptenFsStream, buffer: Uint8Array, offset: number, length: number, position: number) => number;
  llseek?: (stream: EmscriptenFsStream, offset: number, whence: number) => number;
  allocate?: (stream: EmscriptenFsStream, offset: number, length: number) => void;
};

declare module "@ffmpeg/types" {
  interface FS {
    createNode(
      parent: EmscriptenFsNode | null,
      name: string,
      mode: number,
      dev?: number
    ): EmscriptenFsNode;
  }
}
