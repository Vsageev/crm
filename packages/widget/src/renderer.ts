import type { FormConfig, FormField } from './types.js';
import { ApiClient } from './api.js';
import { WIDGET_CSS } from './styles.js';

function getUtmParams(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'] as const) {
    const param = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // utmSource -> utm_source
    const value = params.get(param);
    if (value) utm[key] = value;
  }
  return utm;
}

function createFieldInput(field: FormField, shadow: ShadowRoot): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'ws-form__field';

  if (field.fieldType === 'hidden') {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = field.id;
    input.value = field.defaultValue ?? '';
    wrapper.appendChild(input);
    return wrapper;
  }

  // Label
  if (field.fieldType !== 'checkbox') {
    const label = document.createElement('label');
    label.className = 'ws-form__label';
    if (field.isRequired) label.className += ' ws-form__label--required';
    label.textContent = field.label;
    label.setAttribute('for', `field-${field.id}`);
    wrapper.appendChild(label);
  }

  // Input element
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

  switch (field.fieldType) {
    case 'textarea': {
      input = document.createElement('textarea');
      input.className = 'ws-form__textarea';
      if (field.placeholder) input.placeholder = field.placeholder;
      break;
    }
    case 'select': {
      input = document.createElement('select');
      input.className = 'ws-form__select';
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = field.placeholder ?? 'Select...';
      input.appendChild(emptyOpt);
      if (field.options) {
        for (const opt of field.options) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          input.appendChild(option);
        }
      }
      break;
    }
    case 'checkbox': {
      const checkWrapper = document.createElement('div');
      checkWrapper.className = 'ws-form__checkbox-wrapper';
      input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'ws-form__checkbox';
      const checkLabel = document.createElement('label');
      checkLabel.className = 'ws-form__checkbox-label';
      checkLabel.textContent = field.label;
      checkLabel.setAttribute('for', `field-${field.id}`);
      checkWrapper.appendChild(input);
      checkWrapper.appendChild(checkLabel);
      wrapper.appendChild(checkWrapper);

      input.id = `field-${field.id}`;
      input.name = field.id;
      if (field.isRequired) input.required = true;
      if (field.defaultValue === 'true') (input as HTMLInputElement).checked = true;

      // Error container
      const error = document.createElement('div');
      error.className = 'ws-form__error';
      error.style.display = 'none';
      error.dataset.fieldId = field.id;
      wrapper.appendChild(error);

      return wrapper;
    }
    default: {
      input = document.createElement('input');
      input.className = 'ws-form__input';

      const typeMap: Record<string, string> = {
        text: 'text',
        email: 'email',
        phone: 'tel',
        number: 'number',
        date: 'date',
        url: 'url',
      };
      (input as HTMLInputElement).type = typeMap[field.fieldType] ?? 'text';
      if (field.placeholder) input.placeholder = field.placeholder;
      break;
    }
  }

  input.id = `field-${field.id}`;
  input.name = field.id;
  if (field.isRequired) input.required = true;
  if (field.defaultValue && field.fieldType !== 'select') input.value = field.defaultValue;
  if (field.defaultValue && field.fieldType === 'select') (input as HTMLSelectElement).value = field.defaultValue;

  // Clear error on input
  input.addEventListener('input', () => {
    const errorEl = shadow.querySelector(`[data-field-id="${field.id}"]`) as HTMLElement | null;
    if (errorEl) errorEl.style.display = 'none';
    input.classList.remove('ws-form__input--error', 'ws-form__textarea--error', 'ws-form__select--error');
  });

  wrapper.appendChild(input);

  // Error container
  const error = document.createElement('div');
  error.className = 'ws-form__error';
  error.style.display = 'none';
  error.dataset.fieldId = field.id;
  wrapper.appendChild(error);

  return wrapper;
}

function validateField(field: FormField, value: unknown): string | null {
  const str = String(value ?? '').trim();

  if (field.isRequired) {
    if (field.fieldType === 'checkbox') {
      if (value !== true) return `${field.label} is required`;
    } else if (!str) {
      return `${field.label} is required`;
    }
  }

  if (!str && field.fieldType !== 'checkbox') return null;

  if (field.fieldType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
    return 'Please enter a valid email address';
  }
  if (field.fieldType === 'url' && !/^https?:\/\/.+/.test(str)) {
    return 'Please enter a valid URL';
  }

  return null;
}

function getFieldValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (input.type === 'checkbox') return (input as HTMLInputElement).checked;
  if (input.type === 'number') return input.value ? Number(input.value) : '';
  return input.value;
}

export function renderForm(container: HTMLElement, config: FormConfig, api: ApiClient): void {
  // Create Shadow DOM
  const shadow = container.attachShadow({ mode: 'open' });

  // Inject styles
  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  // Form wrapper
  const formEl = document.createElement('div');
  formEl.className = 'ws-form';
  shadow.appendChild(formEl);

  // Title
  const title = document.createElement('h2');
  title.className = 'ws-form__title';
  title.textContent = config.name;
  formEl.appendChild(title);

  // Description
  if (config.description) {
    const desc = document.createElement('p');
    desc.className = 'ws-form__description';
    desc.textContent = config.description;
    formEl.appendChild(desc);
  }

  // Global error area
  const globalError = document.createElement('div');
  globalError.className = 'ws-form__global-error';
  globalError.style.display = 'none';
  formEl.appendChild(globalError);

  // Form element
  const form = document.createElement('form');
  form.noValidate = true;
  formEl.appendChild(form);

  // Sort fields by position and render
  const sortedFields = [...config.fields].sort((a, b) => a.position - b.position);
  for (const field of sortedFields) {
    form.appendChild(createFieldInput(field, shadow));
  }

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'ws-form__submit';
  submitBtn.textContent = config.submitButtonText || 'Submit';
  form.appendChild(submitBtn);

  // Handle submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    globalError.style.display = 'none';

    // Validate all fields
    let hasErrors = false;
    const data: Record<string, unknown> = {};

    for (const field of sortedFields) {
      const input = shadow.getElementById(`field-${field.id}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!input) continue;

      const value = getFieldValue(input);
      const errorMsg = validateField(field, value);
      const errorEl = shadow.querySelector(`[data-field-id="${field.id}"]`) as HTMLElement | null;

      if (errorMsg) {
        hasErrors = true;
        if (errorEl) {
          errorEl.textContent = errorMsg;
          errorEl.style.display = 'block';
        }
        input.classList.add(
          field.fieldType === 'textarea'
            ? 'ws-form__textarea--error'
            : field.fieldType === 'select'
              ? 'ws-form__select--error'
              : 'ws-form__input--error',
        );
      } else {
        data[field.id] = value;
      }
    }

    if (hasErrors) return;

    // Submit
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const result = await api.submitForm(config.id, data, {
        referrerUrl: document.referrer || undefined,
        ...getUtmParams(),
      });

      // Show success state
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }

      formEl.innerHTML = '';
      const success = document.createElement('div');
      success.className = 'ws-form__success';
      success.innerHTML = `
        <div class="ws-form__success-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <p class="ws-form__success-message"></p>
      `;
      const msgEl = success.querySelector('.ws-form__success-message')!;
      msgEl.textContent = result.successMessage || config.successMessage || 'Thank you for your submission!';
      formEl.appendChild(success);
    } catch (err) {
      globalError.textContent = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      globalError.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = config.submitButtonText || 'Submit';
    }
  });
}

export function renderLoading(container: HTMLElement): ShadowRoot {
  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.className = 'ws-form';
  wrapper.innerHTML = `
    <div class="ws-form__loading">
      <div class="ws-form__spinner"></div>
      <div>Loading form...</div>
    </div>
  `;
  shadow.appendChild(wrapper);
  return shadow;
}

export function renderError(container: HTMLElement, message: string): void {
  // If shadow root already exists (from loading), reuse it
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;

  shadow.innerHTML = '';
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.className = 'ws-form';
  wrapper.innerHTML = `<div class="ws-form__global-error"></div>`;
  const errorEl = wrapper.querySelector('.ws-form__global-error')!;
  errorEl.textContent = message;
  shadow.appendChild(wrapper);
}
