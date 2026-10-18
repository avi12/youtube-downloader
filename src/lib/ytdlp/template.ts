const TEMPLATE_PATTERN = /%\((\w+)(?:>([^)|]*))?(?:\|([^)]*))?\)([-+0 #]*)(\d*)(?:\.(\d+))?([sdiS])|%%/g;
const MISSING_FIELD = "NA";
const SLASH_SUBSTITUTE = "⧸";
const DATE_LENGTH = 8;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTH_LENGTH = 3;
const TWO_DIGITS = 2;
const YEAR_SHORT_LENGTH = 2;
const DATE_FIELDS = new Set(["upload_date", "release_date", "timestamp", "epoch"]);
const DURATION_FIELDS = new Set(["duration", "section_start", "section_end"]);

export type TemplateValue = string | number | boolean | string[] | undefined;
export type TemplateFields = Record<string, TemplateValue>;

function pad(value: number) {
  return String(value).padStart(TWO_DIGITS, "0");
}

function formatDuration(totalSeconds: number, format: string) {
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = Math.floor(totalSeconds % SECONDS_PER_MINUTE);
  return format.replace("%H", pad(hours)).replace("%M", pad(minutes)).replace("%S", pad(seconds));
}

function parseDate(value: TemplateValue) {
  if (typeof value === "number") {
    return new Date(value * 1000);
  }

  const text = String(value);
  if (text.length !== DATE_LENGTH) {
    return undefined;
  }

  return new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8))));
}

function formatDate(value: TemplateValue, format: string) {
  const date = parseDate(value);
  if (!date) {
    return undefined;
  }

  const replacements: Record<string, string> = {
    "%Y": String(date.getUTCFullYear()),
    "%y": String(date.getUTCFullYear()).slice(-YEAR_SHORT_LENGTH),
    "%m": pad(date.getUTCMonth() + 1),
    "%d": pad(date.getUTCDate()),
    "%B": MONTH_NAMES[date.getUTCMonth()]!,
    "%b": MONTH_NAMES[date.getUTCMonth()]!.slice(0, SHORT_MONTH_LENGTH),
    "%H": pad(date.getUTCHours()),
    "%M": pad(date.getUTCMinutes()),
    "%S": pad(date.getUTCSeconds())
  };
  return format.replace(/%[YymdBbHMS]/g, token => replacements[token]!);
}

function stringify(name: string, value: TemplateValue, conversion: string | undefined) {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (conversion && DURATION_FIELDS.has(name) && typeof value === "number") {
    return formatDuration(value, conversion);
  }

  if (conversion && DATE_FIELDS.has(name)) {
    return formatDate(value, conversion);
  }

  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function renderTemplate(template: string, fields: TemplateFields, isPath = false) {
  return template.replace(TEMPLATE_PATTERN, (match, name?: string, conversion?: string, fallback?: string, flags = "", width = "", precision?: string, type?: string) => {
    if (!name) {
      return "%";
    }

    const rawText = stringify(name, fields[name], conversion) ?? fallback ?? MISSING_FIELD;
    const text = isPath ? rawText.replaceAll("/", SLASH_SUBSTITUTE) : rawText;
    const isNumber = type === "d" || type === "i";
    const isNumeric = !Number.isNaN(Number(text));
    if (isNumber && isNumeric) {
      const sign = flags.includes("+") && Number(text) >= 0 ? "+" : "";
      const padded = `${sign}${Math.trunc(Number(text))}`.padStart(Number(width) || 0, flags.includes("0") ? "0" : " ");
      return padded;
    }

    const clipped = precision === undefined ? text : text.slice(0, Number(precision));
    const widthNumber = Number(width) || 0;
    return flags.includes("-") ? clipped.padEnd(widthNumber) : clipped.padStart(widthNumber);
  });
}

export function hasTemplateFields(text: string) {
  return /%\(\w+/.test(text);
}
