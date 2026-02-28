export const WIDGET_CSS = /* css */ `
  :host {
    all: initial;
    display: block;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #1A1A2E;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  .ws-form {
    max-width: 560px;
    background: #FFFFFF;
    border: 1px solid #E8EAED;
    border-radius: 12px;
    padding: 24px;
  }

  .ws-form__title {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 4px;
    color: #1A1A2E;
  }

  .ws-form__description {
    font-size: 15px;
    color: #6B7280;
    margin: 0 0 20px;
  }

  .ws-form__field {
    margin-bottom: 16px;
  }

  .ws-form__label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 6px;
    color: #1A1A2E;
  }

  .ws-form__label--required::after {
    content: ' *';
    color: #EF4444;
  }

  .ws-form__input,
  .ws-form__textarea,
  .ws-form__select {
    display: block;
    width: 100%;
    padding: 10px 12px;
    font-size: 15px;
    font-family: inherit;
    color: #1A1A2E;
    background: #FFFFFF;
    border: 1px solid #E8EAED;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .ws-form__input:focus,
  .ws-form__textarea:focus,
  .ws-form__select:focus {
    border-color: #3B82F6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .ws-form__input::placeholder,
  .ws-form__textarea::placeholder {
    color: #9CA3AF;
  }

  .ws-form__input--error,
  .ws-form__textarea--error,
  .ws-form__select--error {
    border-color: #EF4444;
  }

  .ws-form__textarea {
    min-height: 100px;
    resize: vertical;
  }

  .ws-form__select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%236B7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
  }

  .ws-form__checkbox-wrapper {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .ws-form__checkbox {
    margin-top: 2px;
    width: 16px;
    height: 16px;
    accent-color: #2D2D2D;
  }

  .ws-form__checkbox-label {
    font-size: 15px;
    color: #1A1A2E;
    cursor: pointer;
  }

  .ws-form__error {
    font-size: 13px;
    color: #EF4444;
    margin-top: 4px;
  }

  .ws-form__submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 12px 24px;
    margin-top: 8px;
    font-size: 15px;
    font-weight: 500;
    font-family: inherit;
    color: #FFFFFF;
    background: #2D2D2D;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .ws-form__submit:hover {
    background: #404040;
  }

  .ws-form__submit:disabled {
    background: #9CA3AF;
    cursor: not-allowed;
  }

  .ws-form__success {
    text-align: center;
    padding: 32px 16px;
  }

  .ws-form__success-icon {
    width: 48px;
    height: 48px;
    margin: 0 auto 16px;
    background: rgba(16, 185, 129, 0.1);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ws-form__success-icon svg {
    width: 24px;
    height: 24px;
    color: #10B981;
  }

  .ws-form__success-message {
    font-size: 18px;
    font-weight: 500;
    color: #1A1A2E;
    margin: 0;
  }

  .ws-form__global-error {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 16px;
    font-size: 14px;
    color: #EF4444;
  }

  .ws-form__loading {
    text-align: center;
    padding: 32px 16px;
    color: #6B7280;
    font-size: 15px;
  }

  .ws-form__spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 2.5px solid #E8EAED;
    border-top-color: #2D2D2D;
    border-radius: 50%;
    animation: ws-spin 0.6s linear infinite;
    margin-bottom: 12px;
  }

  @keyframes ws-spin {
    to { transform: rotate(360deg); }
  }
`;
