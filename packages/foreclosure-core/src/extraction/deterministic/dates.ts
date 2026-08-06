const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Parses "September 1, 2026" or "09/01/2026" style dates found near a label. Returns an ISO date string (yyyy-mm-dd) or null. */
export function parseLabeledDate(text: string, labelPattern: RegExp): string | null {
  const labelMatch = text.match(labelPattern);
  if (!labelMatch) return null;
  const windowStart = labelMatch.index ?? 0;
  const window = text.slice(windowStart, windowStart + 200);
  return parseFirstDate(window);
}

export function parseFirstDate(text: string): string | null {
  const longForm = text.match(
    new RegExp(`(${MONTH_NAMES.join("|")})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i"),
  );
  if (longForm) {
    const monthIndex = MONTH_NAMES.indexOf(longForm[1]!.toLowerCase());
    const day = Number(longForm[2]);
    const year = Number(longForm[3]);
    return toIsoDate(year, monthIndex + 1, day);
  }

  const numeric = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = Number(numeric[3]);
    return toIsoDate(year, month, day);
  }

  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Extracts a time like "10:00 AM" near a label. */
export function parseLabeledTime(text: string, labelPattern: RegExp): string | null {
  const labelMatch = text.match(labelPattern);
  if (!labelMatch) return null;
  const windowStart = labelMatch.index ?? 0;
  const window = text.slice(windowStart, windowStart + 120);
  const timeMatch = window.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
  return timeMatch ? `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3]!.toUpperCase()}` : null;
}
