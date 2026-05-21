import "./emscripten-fs.d";
import type { EmscriptenFsNode, EmscriptenNodeOps, EmscriptenStreamOps } from "./emscripten-fs.d";
import type { FS } from "@ffmpeg/types";

export const OPFS_MUX_OUTPUT_SUFFIX = "-mux-out";
const DIR_MODE = 16384 | 511;  // directory, rwxrwxrwx
const FILE_MODE = 32768 | 511; // regular file, rwxrwxrwx

export async function createOpfsOutputHandle(videoId: string) {
  const root = await navigator.storage.getDirectory();
  return root.getFileHandle(videoId + OPFS_MUX_OUTPUT_SUFFIX, { create: true });
}

export async function cleanupOpfsOutput(videoId: string) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(videoId + OPFS_MUX_OUTPUT_SUFFIX);
  } catch { /* no-op */ }
}

function asDir(node: EmscriptenFsNode): Record<string, EmscriptenFsNode> {
  const { contents } = node;
  const isNotDirectory = !contents || contents instanceof Uint8Array;
  if (isNotDirectory) {
    throw new Error("Not a directory node");
  }

  return contents;
}

function makeNodeOps(opfsFs: ReturnType<typeof makeOpfsFs>): EmscriptenNodeOps {
  return {
    getattr(node) {
      const isDir = !!(node.mode & 16384);
      return {
        dev: 1,
        ino: 0,
        mode: node.mode,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: isDir ? 4096 : (node.fileSize ?? 0),
        atime: new Date(node.timestamp),
        mtime: new Date(node.timestamp),
        ctime: new Date(node.timestamp),
        blksize: 4096,
        blocks: 0
      };
    },
    setattr(node, attr) {
      if (attr.mode !== undefined) {
        node.mode = attr.mode;
      }

      if (attr.timestamp !== undefined) {
        node.timestamp = attr.timestamp;
      }
    },
    readdir(node) {
      const names = [".", ".."];
      const dir = asDir(node);
      for (const name in dir) {
        names.push(name);
      }
      return names;
    },
    lookup(parent, name) {
      const dir = asDir(parent);
      const node = dir[name];
      if (!node) {
        throw new Error(`ENOENT: ${name}`);
      }

      return node;
    },
    mknod(parent, name, mode) {
      return opfsFs.createFileNode(parent, name, mode);
    }
  };
}

function makeStreamOps(): EmscriptenStreamOps {
  return {
    open(_stream) {},
    write(stream, buffer, offset, length, position) {
      const { node } = stream;
      const syncHandle = node.syncHandle!;
      const chunk = buffer.subarray(offset, offset + length);
      syncHandle.write(chunk, { at: position });
      const newEnd = position + length;
      if (newEnd > (node.fileSize ?? 0)) {
        node.fileSize = newEnd;
      }

      return length;
    },
    read(stream, buffer, offset, length, position) {
      const { node } = stream;
      const syncHandle = node.syncHandle!;
      const fileSize = node.fileSize ?? 0;
      if (position >= fileSize) {
        return 0;
      }

      const readLength = Math.min(length, fileSize - position);
      const slice = buffer.subarray(offset, offset + readLength);
      return syncHandle.read(slice, { at: position });
    },
    llseek(stream, offset, whence) {
      const { node } = stream;
      const fileSize = node.fileSize ?? 0;
      let position = offset;
      if (whence === 1) {
        position += stream.position;
      } else if (whence === 2) {
        position += fileSize;
      }

      if (position < 0) {
        throw new Error("EINVAL: negative seek position");
      }

      return position;
    }
  };
}

function makeOpfsFs(fs: FS, syncHandle: FileSystemSyncAccessHandle) {
  const nodeOpsRef: { current: EmscriptenNodeOps } = {
    current: {}
  };
  const streamOps = makeStreamOps();

  const opfsFs = {
    createFileNode(parent: EmscriptenFsNode, name: string, mode: number): EmscriptenFsNode {
      const node = fs.createNode(parent, name, mode, 0);
      node.node_ops = nodeOpsRef.current;
      node.stream_ops = streamOps;
      node.syncHandle = syncHandle;
      node.fileSize = 0;
      node.timestamp = Date.now();
      const dir = asDir(parent);
      dir[name] = node;
      return node;
    },
    mount(mount: {
      opts: Record<string, unknown>;
      mountpoint: string;
    }) {
      const { outputFilename } = mount.opts;
      const root = fs.createNode(null, "/", DIR_MODE, 0);
      root.node_ops = nodeOpsRef.current;
      root.stream_ops = streamOps;
      root.contents = {};
      root.timestamp = Date.now();

      const isOutputFilenameValid = typeof outputFilename === "string" && outputFilename;
      if (isOutputFilenameValid) {
        opfsFs.createFileNode(root, outputFilename, FILE_MODE);
      }

      return root;
    }
  };

  nodeOpsRef.current = makeNodeOps(opfsFs);
  return opfsFs;
}

type CreateOpfsOutputFsParams = {
  fs: FS;
  syncHandle: FileSystemSyncAccessHandle;
  outputFilename: string;
};
export function createOpfsOutputFs({ fs, syncHandle, outputFilename }: CreateOpfsOutputFsParams) {
  const driver = makeOpfsFs(fs, syncHandle);

  return {
    mount(mount: {
      opts: Record<string, unknown>;
      mountpoint: string;
    }) {
      return driver.mount({
        ...mount,
        opts: {
          ...mount.opts,
          outputFilename
        }
      });
    }
  };
}
