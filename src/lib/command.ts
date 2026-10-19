const ARGUMENT_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
export const URL_TOKEN = "URL";

export function tokenize(command: string) {
  return Array.from(
    command.matchAll(ARGUMENT_PATTERN),
    ([, doubleQuoted, singleQuoted, bare]) => doubleQuoted ?? singleQuoted ?? bare ?? ""
  );
}
