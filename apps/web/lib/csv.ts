/** Minimal, dependency-free CSV encoder — escapes quotes/commas/newlines per RFC 4180. */
export function toCsv(rows: Array<Record<string, string | number | null>>): string {
  const [firstRow] = rows;
  if (!firstRow) return "";
  const headers = Object.keys(firstRow);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(","));
  }
  return lines.join("\r\n");
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
