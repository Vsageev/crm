import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';
import { createContact } from './contacts.js';
import { createDeal } from './deals.js';
import { findContactDuplicates } from './duplicates.js';
import { createNotification } from './notifications.js';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface WebFormListQuery {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateWebFormFieldData {
  label: string;
  fieldType?: string;
  placeholder?: string;
  isRequired?: boolean;
  position?: number;
  options?: string[];
  defaultValue?: string;
  contactFieldMapping?: string;
}

export interface CreateWebFormData {
  name: string;
  description?: string;
  status?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  assigneeId?: string;
  submitButtonText?: string;
  successMessage?: string;
  redirectUrl?: string;
  fields?: CreateWebFormFieldData[];
}

export interface UpdateWebFormData {
  name?: string;
  description?: string | null;
  status?: string;
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  assigneeId?: string | null;
  submitButtonText?: string;
  successMessage?: string;
  redirectUrl?: string | null;
  fields?: CreateWebFormFieldData[];
}

export interface SubmissionListQuery {
  formId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface CreateSubmissionData {
  formId: string;
  data: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  referrerUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

interface AuditContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

// ── Forms CRUD ──────────────────────────────────────────────────────────

export async function listWebForms(query: WebFormListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (query.status && r.status !== query.status) return false;
    if (query.search && !(r.name as string)?.toLowerCase().includes(query.search.toLowerCase())) return false;
    return true;
  };

  const all = store.find('webForms', predicate)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  const total = all.length;
  const entries = all.slice(offset, offset + limit);

  return { entries, total };
}

export async function getWebFormById(id: string) {
  const form = store.getById('webForms', id);
  if (!form) return null;

  const fields = store
    .find('webFormFields', (r) => r.formId === id)
    .sort((a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0));

  return { ...form, fields };
}

export async function createWebForm(data: CreateWebFormData, audit?: AuditContext) {
  const { fields, ...formData } = data;

  const form = store.insert('webForms', formData);

  if (fields && fields.length > 0) {
    store.insertMany(
      'webFormFields',
      fields.map((field, idx) => ({
        ...field,
        formId: form.id,
        position: field.position ?? idx,
      })),
    );
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'web_form',
      entityId: form.id as string,
      changes: formData,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getWebFormById(form.id as string);
}

export async function updateWebForm(id: string, data: UpdateWebFormData, audit?: AuditContext) {
  const { fields, ...formData } = data;

  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formData)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }

  const updated = store.update('webForms', id, setData);
  if (!updated) return null;

  // Replace fields if provided
  if (fields !== undefined) {
    store.deleteWhere('webFormFields', (r) => r.formId === id);
    if (fields.length > 0) {
      store.insertMany(
        'webFormFields',
        fields.map((field, idx) => ({
          ...field,
          formId: id,
          position: field.position ?? idx,
        })),
      );
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'web_form',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getWebFormById(id);
}

export async function deleteWebForm(id: string, audit?: AuditContext) {
  const deleted = store.delete('webForms', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'web_form',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}

// ── Submissions ─────────────────────────────────────────────────────────

export async function listSubmissions(query: SubmissionListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (query.formId && r.formId !== query.formId) return false;
    if (query.status && r.status !== query.status) return false;
    return true;
  };

  const all = store.find('webFormSubmissions', predicate)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  const total = all.length;
  const entries = all.slice(offset, offset + limit);

  return { entries, total };
}

export async function getSubmissionById(id: string) {
  return store.getById('webFormSubmissions', id) ?? null;
}

export async function createSubmission(data: CreateSubmissionData) {
  const submission = store.insert('webFormSubmissions', { ...data });
  return submission;
}

export async function updateSubmission(
  id: string,
  data: { contactId?: string; dealId?: string; status?: string },
) {
  const setData: Record<string, unknown> = {};
  if (data.contactId !== undefined) setData.contactId = data.contactId;
  if (data.dealId !== undefined) setData.dealId = data.dealId;
  if (data.status !== undefined) setData.status = data.status;

  const updated = store.update('webFormSubmissions', id, setData);
  return updated ?? null;
}

// ── Contact field mapping keys ──────────────────────────────────────────
const CONTACT_FIELD_MAPPINGS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'position',
  'notes',
] as const;

type ContactFieldKey = (typeof CONTACT_FIELD_MAPPINGS)[number];

interface FormWithFields {
  id: string;
  pipelineId: string | null;
  pipelineStageId: string | null;
  assigneeId: string | null;
  name: string;
  fields: {
    id: string;
    label: string;
    contactFieldMapping: string | null;
  }[];
}

interface SubmissionWithUtm {
  id: string;
  data: Record<string, unknown>;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  referrerUrl?: string | null;
}

/**
 * Process a form submission: extract contact data from mapped fields,
 * check for duplicates, create or reuse a contact, optionally create a deal,
 * then update the submission record with references.
 * UTM / lead source data from the submission is propagated to the contact and deal.
 */
export async function processFormSubmission(
  form: FormWithFields,
  submission: SubmissionWithUtm,
) {
  // 1. Extract contact data from submission using field mappings
  const contactData: Partial<Record<ContactFieldKey, string>> = {};
  for (const field of form.fields) {
    if (
      field.contactFieldMapping &&
      CONTACT_FIELD_MAPPINGS.includes(field.contactFieldMapping as ContactFieldKey)
    ) {
      const value = submission.data[field.id];
      if (value !== undefined && value !== null && value !== '') {
        contactData[field.contactFieldMapping as ContactFieldKey] = String(value);
      }
    }
  }

  // Must have at least a firstName to create a contact
  if (!contactData.firstName) {
    // Try to derive a name from email if available
    if (contactData.email) {
      contactData.firstName = contactData.email.split('@')[0];
    } else {
      // Cannot create a contact without a name — mark as failed
      await updateSubmission(submission.id as string, { status: 'failed' });
      return { contact: null, deal: null, isDuplicate: false };
    }
  }

  // 2. Check for duplicate contacts
  let contactId: string | null = null;
  let isDuplicate = false;

  const dupeResult = await findContactDuplicates({
    email: contactData.email,
    phone: contactData.phone,
    firstName: contactData.firstName,
    lastName: contactData.lastName,
  });

  if (dupeResult.hasDuplicates) {
    // Use the first (best) match
    contactId = dupeResult.duplicates[0].id;
    isDuplicate = true;
  }

  // Build UTM tracking data to propagate
  const utmFields = {
    utmSource: submission.utmSource ?? undefined,
    utmMedium: submission.utmMedium ?? undefined,
    utmCampaign: submission.utmCampaign ?? undefined,
    utmTerm: submission.utmTerm ?? undefined,
    utmContent: submission.utmContent ?? undefined,
    referrerUrl: submission.referrerUrl ?? undefined,
  };

  // 3. Create contact if no duplicate found
  if (!contactId) {
    const contact = await createContact({
      firstName: contactData.firstName,
      lastName: contactData.lastName,
      email: contactData.email,
      phone: contactData.phone,
      position: contactData.position,
      notes: contactData.notes,
      source: 'web_form',
      ownerId: form.assigneeId ?? undefined,
      ...utmFields,
    });
    contactId = contact.id;
  }

  // 4. Create deal if pipeline is configured
  let dealId: string | null = null;
  if (form.pipelineId && form.pipelineStageId) {
    const dealTitle = contactData.email
      ? `Lead from ${form.name} — ${contactData.email}`
      : `Lead from ${form.name} — ${contactData.firstName}${contactData.lastName ? ' ' + contactData.lastName : ''}`;

    const deal = await createDeal({
      title: dealTitle,
      pipelineId: form.pipelineId as string,
      pipelineStageId: form.pipelineStageId as string,
      contactId: contactId ?? undefined,
      ownerId: form.assigneeId ?? undefined,
      stage: 'new',
      leadSource: 'web_form',
      ...utmFields,
    });
    dealId = deal.id as string;
  }

  // 5. Update submission with contact/deal references
  await updateSubmission(submission.id as string, {
    contactId: contactId ?? undefined,
    dealId: dealId ?? undefined,
    status: 'processed',
  });

  // 6. Notify the assignee about the new lead (fire-and-forget)
  if (form.assigneeId) {
    createNotification({
      userId: form.assigneeId,
      type: 'lead_assigned',
      title: 'New lead from web form',
      message: `A new submission was received from "${form.name}"${contactData.email ? ` (${contactData.email})` : ''}.`,
      entityType: dealId ? 'deal' : 'contact',
      entityId: (dealId ?? contactId) as string,
    }).catch(() => {
      // Non-critical — don't fail the submission
    });
  }

  return { contactId, dealId, isDuplicate };
}
