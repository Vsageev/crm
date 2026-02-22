export interface FormField {
  id: string;
  label: string;
  fieldType: 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'url' | 'hidden';
  placeholder: string | null;
  isRequired: boolean;
  position: number;
  options: string[] | null;
  defaultValue: string | null;
}

export interface FormConfig {
  id: string;
  name: string;
  description: string | null;
  submitButtonText: string;
  successMessage: string;
  redirectUrl: string | null;
  fields: FormField[];
}

export interface SubmitResponse {
  id: string;
  successMessage: string;
  redirectUrl: string | null;
}

export interface CrmFormOptions {
  formId: string;
  container: string | HTMLElement;
  apiUrl: string;
}
