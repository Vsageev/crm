import { beforeAll, describe, expect, it } from 'vitest';
import { store } from '../db/index.js';
import { listWebForms } from './web-forms.js';

describe('web-forms service', () => {
  beforeAll(async () => {
    await store.init();
  });

  it('returns list entries with fields arrays hydrated and sorted', async () => {
    const testId = Date.now().toString(36);
    const formWithFieldsId = `test-form-with-fields-${testId}`;
    const formWithoutFieldsId = `test-form-without-fields-${testId}`;
    const search = `web-forms-test-${testId}`;

    const formWithFields = store.insert('webForms', {
      id: formWithFieldsId,
      name: `${search}-a`,
      status: 'active',
      submitButtonText: 'Submit',
      successMessage: 'Thanks',
      createdBy: 'user-1',
    });
    const formWithoutFields = store.insert('webForms', {
      id: formWithoutFieldsId,
      name: `${search}-b`,
      status: 'inactive',
      submitButtonText: 'Send',
      successMessage: 'Done',
      createdBy: 'user-1',
    });

    store.insert('webFormFields', {
      id: `test-field-1-${testId}`,
      formId: formWithFields.id,
      label: 'Second',
      fieldType: 'text',
      position: 2,
      isRequired: false,
    });
    store.insert('webFormFields', {
      id: `test-field-2-${testId}`,
      formId: formWithFields.id,
      label: 'First',
      fieldType: 'text',
      position: 0,
      isRequired: true,
    });

    try {
      const { entries } = await listWebForms({ limit: 10, offset: 0, search });
      const typedEntries = entries as Array<Record<string, unknown> & { fields: Array<Record<string, unknown>> }>;

      const hydrated = typedEntries.find((entry) => entry.id === formWithFieldsId);
      const empty = typedEntries.find((entry) => entry.id === formWithoutFieldsId);

      expect(hydrated).toBeDefined();
      expect(Array.isArray(hydrated?.fields)).toBe(true);
      expect((hydrated?.fields as Array<{ label: string }>).map((field) => field.label)).toEqual([
        'First',
        'Second',
      ]);

      expect(empty).toBeDefined();
      expect(empty?.fields).toEqual([]);
    } finally {
      store.deleteWhere('webFormFields', (row) => row.formId === formWithFieldsId);
      store.delete('webForms', formWithFieldsId);
      store.delete('webForms', formWithoutFieldsId);
      await store.flush();
    }
  });
});
