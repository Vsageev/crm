import { store } from '../db/index.js';
import { createContact, type ContactListQuery } from './contacts.js';
import { createAuditLog } from './audit-log.js';

const CSV_HEADERS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'position',
  'source',
  'notes',
] as const;

const DISPLAY_HEADERS = [
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Position',
  'Source',
  'Notes',
];

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

export async function exportContactsCsv(query: ContactListQuery): Promise<string> {
  let rows = store.getAll('contacts');

  // Apply filters
  rows = rows.filter((r) => {
    if (query.ownerId && r.ownerId !== query.ownerId) return false;
    if (query.companyId && r.companyId !== query.companyId) return false;
    if (query.source && r.source !== query.source) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      const matchFirst = (r.firstName as string)?.toLowerCase().includes(term);
      const matchLast = (r.lastName as string)?.toLowerCase().includes(term);
      const matchEmail = (r.email as string)?.toLowerCase().includes(term);
      const matchPhone = (r.phone as string)?.toLowerCase().includes(term);
      if (!matchFirst && !matchLast && !matchEmail && !matchPhone) return false;
    }
    return true;
  });

  // Sort by createdAt descending
  rows.sort(
    (a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime(),
  );

  const lines: string[] = [DISPLAY_HEADERS.join(',')];

  for (const row of rows) {
    const values = CSV_HEADERS.map((header) => escapeCsvField(row[header] as string | null | undefined));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export interface CsvImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const VALID_SOURCES = ['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'];

export async function importContactsCsv(
  csvContent: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
): Promise<CsvImportResult> {
  const lines = csvContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { imported: 0, skipped: 0, errors: [{ row: 0, message: 'CSV file is empty or has no data rows' }] };
  }

  const headerLine = parseCsvLine(lines[0]);
  const headerMap = new Map<string, number>();

  for (let i = 0; i < headerLine.length; i++) {
    const normalized = normalizeHeader(headerLine[i]);
    if (normalized) {
      headerMap.set(normalized, i);
    }
  }

  if (!headerMap.has('firstName')) {
    return {
      imported: 0,
      skipped: 0,
      errors: [{ row: 1, message: 'CSV must contain a "First Name" (or "firstName") column' }],
    };
  }

  const result: CsvImportResult = { imported: 0, skipped: 0, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);

    const firstName = getField(fields, headerMap, 'firstName');
    if (!firstName) {
      result.errors.push({ row: i + 1, message: 'Missing required field: firstName' });
      result.skipped++;
      continue;
    }

    if (firstName.length > 100) {
      result.errors.push({ row: i + 1, message: 'firstName exceeds 100 characters' });
      result.skipped++;
      continue;
    }

    const email = getField(fields, headerMap, 'email');
    if (email && !isValidEmail(email)) {
      result.errors.push({ row: i + 1, message: `Invalid email: ${email}` });
      result.skipped++;
      continue;
    }

    const source = getField(fields, headerMap, 'source');

    try {
      await createContact(
        {
          firstName,
          lastName: getField(fields, headerMap, 'lastName') || undefined,
          email: email || undefined,
          phone: getField(fields, headerMap, 'phone') || undefined,
          position: getField(fields, headerMap, 'position') || undefined,
          source: source && VALID_SOURCES.includes(source) ? source : 'csv_import',
          notes: getField(fields, headerMap, 'notes') || undefined,
        },
        audit,
      );
      result.imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push({ row: i + 1, message });
      result.skipped++;
    }
  }

  if (audit && result.imported > 0) {
    await createAuditLog({
      userId: audit.userId,
      action: 'import',
      entityType: 'contact',
      changes: { totalImported: result.imported, totalSkipped: result.skipped },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return result;
}

function normalizeHeader(header: string): string | null {
  const h = header.trim().toLowerCase().replace(/[^a-z]/g, '');
  const map: Record<string, string> = {
    firstname: 'firstName',
    lastname: 'lastName',
    email: 'email',
    phone: 'phone',
    position: 'position',
    source: 'source',
    notes: 'notes',
  };
  return map[h] ?? null;
}

function getField(fields: string[], headerMap: Map<string, number>, key: string): string | null {
  const idx = headerMap.get(key);
  if (idx === undefined || idx >= fields.length) return null;
  const val = fields[idx].trim();
  return val.length > 0 ? val : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
