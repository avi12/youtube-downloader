export function getFileExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  const hasDot = iDot !== -1;
  if (!hasDot) {
    return "";
  }

  return filename.slice(iDot + 1);
}

export function splitFilenameAndExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  const hasDot = iDot !== -1;
  if (!hasDot) {
    return {
      name: filename,
      extension: ""
    };
  }

  return {
    name: filename.slice(0, iDot),
    extension: filename.slice(iDot + 1)
  };
}
