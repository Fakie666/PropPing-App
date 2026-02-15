export type PropertyCsvRow = {
  propertyRef: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  postcode: string;
  notes: string | null;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

export function parsePropertyCsv(content: string): PropertyCsvRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const idx = {
    propertyRef: headers.indexOf("propertyref"),
    addressLine1: headers.indexOf("addressline1"),
    addressLine2: headers.indexOf("addressline2"),
    city: headers.indexOf("city"),
    postcode: headers.indexOf("postcode"),
    notes: headers.indexOf("notes")
  };

  if (idx.propertyRef === -1 || idx.addressLine1 === -1 || idx.postcode === -1) {
    throw new Error("CSV must include headers: propertyRef,addressLine1,postcode");
  }

  const output: PropertyCsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const propertyRef = cells[idx.propertyRef]?.trim();
    const addressLine1 = cells[idx.addressLine1]?.trim();
    const postcode = cells[idx.postcode]?.trim();

    if (!propertyRef || !addressLine1 || !postcode) {
      continue;
    }

    const addressLine2 = idx.addressLine2 >= 0 ? cells[idx.addressLine2]?.trim() : "";
    const city = idx.city >= 0 ? cells[idx.city]?.trim() : "";
    const notes = idx.notes >= 0 ? cells[idx.notes]?.trim() : "";

    output.push({
      propertyRef,
      addressLine1,
      addressLine2: addressLine2 || null,
      city: city || null,
      postcode,
      notes: notes || null
    });
  }

  return output;
}
