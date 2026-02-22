import type { CrmFormOptions } from './types.js';
import { ApiClient } from './api.js';
import { renderForm, renderLoading, renderError } from './renderer.js';

async function init(options: CrmFormOptions): Promise<void> {
  const { formId, container, apiUrl } = options;

  const el = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
  if (!el) {
    throw new Error(`CrmForm: container "${container}" not found`);
  }

  // Show loading state
  renderLoading(el);

  const api = new ApiClient(apiUrl);

  try {
    const config = await api.fetchForm(formId);

    // Clear shadow root from loading, recreate with form
    // We need a fresh element since shadow root can only be attached once
    const fresh = document.createElement('div');
    el.replaceWith(fresh);
    // Preserve the same id/class for reference
    fresh.id = el.id;
    fresh.className = el.className;

    renderForm(fresh, config, api);
  } catch (err) {
    renderError(el, err instanceof Error ? err.message : 'Failed to load form');
  }
}

function autoInit(): void {
  const elements = document.querySelectorAll<HTMLElement>('[data-crm-form]');
  for (const el of elements) {
    const formId = el.dataset.crmForm;
    const apiUrl = el.dataset.crmApiUrl;
    if (!formId || !apiUrl) continue;
    init({ formId, apiUrl, container: el });
  }
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}

// Export for programmatic usage
// In IIFE mode, Vite wraps everything under the `CrmForm` global
export { init };
