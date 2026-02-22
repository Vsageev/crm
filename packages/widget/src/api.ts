import type { FormConfig, SubmitResponse } from './types.js';

export class ApiClient {
  constructor(private baseUrl: string) {}

  async fetchForm(formId: string): Promise<FormConfig> {
    const res = await fetch(`${this.baseUrl}/api/public/web-forms/${formId}`);
    if (!res.ok) {
      throw new Error(res.status === 404 ? 'Form not found' : `Failed to load form (${res.status})`);
    }
    return res.json();
  }

  async submitForm(
    formId: string,
    data: Record<string, unknown>,
    meta: { referrerUrl?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string },
  ): Promise<SubmitResponse> {
    const res = await fetch(`${this.baseUrl}/api/public/web-forms/${formId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, ...meta }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body as { message?: string })?.message ?? `Submission failed (${res.status})`);
    }
    return res.json();
  }
}
