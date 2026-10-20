import { matchesComparison, parseNumber } from "./selector";
import type { FieldReader } from "./selector";
import type { TemplateFields } from "./template";

const RELATIVE_DATE_PATTERN = /^(now|today|yesterday)(?:([+-])(\d+)(day|week|month|year)s?)?$/;
const ABSOLUTE_DATE_PATTERN = /^(\d{4})-?(\d{2})-?(\d{2})$/;
const BARE_KEY_PATTERN = /^(!?)\s*(\w+)$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const DAYS_PER_UNIT: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365
};

export function toReader(fields: TemplateFields): FieldReader {
  return name => {
    const value = fields[name];
    if (Array.isArray(value)) {
      return value.join(",");
    }

    return typeof value === "boolean" ? String(value) : value;
  };
}

function isTruthy(value: string | number | undefined) {
  return value !== undefined && value !== "" && value !== 0 && value !== "false";
}

type ExpressionRequest = {
  read: FieldReader;
  expression: string;
};
export type FilterRequest = {
  fields: TemplateFields;
  expressions: string[];
};
export type DateSpecRequest = {
  text: string;
  now?: Date;
};

function matchesExpression({ read, expression }: ExpressionRequest) {
  const parts = expression.split("&").map(part => part.trim()).filter(Boolean);
  return parts.every(part => {
    const bare = part.match(BARE_KEY_PATTERN);
    if (bare) {
      return isTruthy(read(bare[2]!)) !== Boolean(bare[1]);
    }

    return matchesComparison({
      read,
      filterText: `[${part}]`
    });
  });
}

export function matchesAnyFilter({ fields, expressions }: FilterRequest) {
  if (!expressions.length) {
    return true;
  }

  const read = toReader(fields);
  return expressions.some(expression => matchesExpression({
    read,
    expression
  }));
}

function formatDay(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function parseDateSpec({ text, now = new Date() }: DateSpecRequest) {
  const absolute = text.match(ABSOLUTE_DATE_PATTERN);
  if (absolute) {
    return `${absolute[1]}${absolute[2]}${absolute[3]}`;
  }

  const relative = text.match(RELATIVE_DATE_PATTERN);
  if (!relative) {
    throw new Error(`Can't read the date ${text}`);
  }

  const [, anchor, sign, amount, unit] = relative;
  const anchorOffset = anchor === "yesterday" ? -1 : 0;
  const offset = (sign === "+" ? 1 : -1) * Number(amount ?? 0) * (DAYS_PER_UNIT[unit ?? "day"] ?? 1);
  return formatDay(new Date(now.getTime() + (anchorOffset + offset) * MILLISECONDS_PER_DAY));
}

export function parseByteSize(text: string) {
  const size = parseNumber(text);
  if (size === undefined) {
    throw new Error(`Can't read the size ${text}`);
  }

  return size;
}
