import { store } from '../db/index.js';

export type DuplicateMatchField = 'email' | 'phone' | 'name';

export interface DuplicateMatch {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  matchedOn: DuplicateMatchField[];
}

export interface DuplicateCheckResult {
  hasDuplicates: boolean;
  duplicates: DuplicateMatch[];
}

export interface CompanyDuplicateMatch {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  matchedOn: ('name' | 'phone')[];
}

export interface CompanyDuplicateCheckResult {
  hasDuplicates: boolean;
  duplicates: CompanyDuplicateMatch[];
}

/**
 * Normalize phone number by stripping non-digit characters (except leading +).
 */
function normalizePhone(phone: string): string {
  const hasPlus = phone.startsWith('+');
  const digits = phone.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Check for duplicate contacts by email, phone, or name.
 * Returns matching contacts grouped by match type.
 */
export async function findContactDuplicates(
  data: { email?: string | null; phone?: string | null; firstName?: string; lastName?: string | null },
  excludeId?: string,
): Promise<DuplicateCheckResult> {
  const inputEmail = data.email?.toLowerCase() ?? null;
  const inputPhone = data.phone ? normalizePhone(data.phone).replace(/^\+/, '').slice(-10) : null;
  const inputFirstName = data.firstName?.toLowerCase() ?? null;
  const inputLastName = data.lastName?.toLowerCase() ?? null;

  if (!inputEmail && !inputPhone && !(inputFirstName && inputLastName)) {
    return { hasDuplicates: false, duplicates: [] };
  }

  const rows = store.find('contacts', (r) => {
    if (excludeId && r.id === excludeId) return false;

    // Check email match
    if (inputEmail && (r.email as string)?.toLowerCase() === inputEmail) return true;

    // Check phone match
    if (inputPhone && r.phone) {
      const rowNorm = normalizePhone(r.phone as string).replace(/^\+/, '').slice(-10);
      if (rowNorm === inputPhone) return true;
    }

    // Check name match
    if (
      inputFirstName &&
      inputLastName &&
      (r.firstName as string)?.toLowerCase() === inputFirstName &&
      (r.lastName as string)?.toLowerCase() === inputLastName
    ) {
      return true;
    }

    return false;
  }).slice(0, 20);

  // For each row, determine which fields matched
  const duplicates: DuplicateMatch[] = rows.map((row) => {
    const matchedOn: DuplicateMatchField[] = [];

    if (inputEmail && (row.email as string)?.toLowerCase() === inputEmail) {
      matchedOn.push('email');
    }

    if (inputPhone && row.phone) {
      const rowNorm = normalizePhone(row.phone as string).replace(/^\+/, '').slice(-10);
      if (rowNorm === inputPhone) {
        matchedOn.push('phone');
      }
    }

    if (
      inputFirstName &&
      inputLastName &&
      (row.firstName as string)?.toLowerCase() === inputFirstName &&
      (row.lastName as string)?.toLowerCase() === inputLastName
    ) {
      matchedOn.push('name');
    }

    return {
      id: row.id as string,
      firstName: row.firstName as string,
      lastName: row.lastName as string | null,
      email: row.email as string | null,
      phone: row.phone as string | null,
      matchedOn,
    };
  });

  // Filter out rows where we couldn't confirm the match (edge case)
  const confirmed = duplicates.filter((d) => d.matchedOn.length > 0);

  return {
    hasDuplicates: confirmed.length > 0,
    duplicates: confirmed,
  };
}

/**
 * Check for duplicate companies by name or phone.
 */
export async function findCompanyDuplicates(
  data: { name?: string; phone?: string | null },
  excludeId?: string,
): Promise<CompanyDuplicateCheckResult> {
  const inputName = data.name?.toLowerCase() ?? null;
  const inputPhone = data.phone ? normalizePhone(data.phone).replace(/^\+/, '').slice(-10) : null;

  if (!inputName && !inputPhone) {
    return { hasDuplicates: false, duplicates: [] };
  }

  const rows = store.find('companies', (r) => {
    if (excludeId && r.id === excludeId) return false;

    if (inputName && (r.name as string)?.toLowerCase() === inputName) return true;

    if (inputPhone && r.phone) {
      const rowNorm = normalizePhone(r.phone as string).replace(/^\+/, '').slice(-10);
      if (rowNorm === inputPhone) return true;
    }

    return false;
  }).slice(0, 20);

  const duplicates: CompanyDuplicateMatch[] = rows.map((row) => {
    const matchedOn: ('name' | 'phone')[] = [];

    if (inputName && (row.name as string)?.toLowerCase() === inputName) {
      matchedOn.push('name');
    }

    if (inputPhone && row.phone) {
      const rowNorm = normalizePhone(row.phone as string).replace(/^\+/, '').slice(-10);
      if (rowNorm === inputPhone) {
        matchedOn.push('phone');
      }
    }

    return {
      id: row.id as string,
      name: row.name as string,
      phone: row.phone as string | null,
      website: row.website as string | null,
      matchedOn,
    };
  });

  const confirmed = duplicates.filter((d) => d.matchedOn.length > 0);

  return {
    hasDuplicates: confirmed.length > 0,
    duplicates: confirmed,
  };
}
