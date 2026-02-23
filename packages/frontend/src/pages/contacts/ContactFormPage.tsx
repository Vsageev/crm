import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Input, Select, Textarea } from '../../ui';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/error-messages';
import type { ContactSource } from 'shared';
import styles from './ContactFormPage.module.css';

interface ContactData {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  source: ContactSource;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

const SOURCES: { value: ContactSource; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'csv_import', label: 'CSV Import' },
  { value: 'web_form', label: 'Web Form' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'email', label: 'Email' },
  { value: 'api', label: 'API' },
  { value: 'other', label: 'Other' },
];

export function ContactFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const formRef = useRef<HTMLFormElement>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [source, setSource] = useState<ContactSource>('manual');
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);

  useEffect(() => {
    if (!id) return;

    async function fetchContact() {
      setFetching(true);
      try {
        const data = await api<ContactData>(`/contacts/${id}`);
        setFirstName(data.firstName);
        setLastName(data.lastName || '');
        setEmail(data.email || '');
        setPhone(data.phone || '');
        setPosition(data.position || '');
        setSource(data.source);
        setNotes(data.notes || '');
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setFetching(false);
      }
    }

    fetchContact();
  }, [id]);

  function clearFieldError(field: string) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function focusFirstError(errors: Record<string, string>) {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey || !formRef.current) return;
    const el = formRef.current.querySelector<HTMLElement>(
      `#${firstKey.replace(/\s+/g, '-')}`,
    ) || formRef.current.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[name="${firstKey}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) {
      errors.firstName = 'First name is required';
    } else if (firstName.length > 100) {
      errors.firstName = 'First name must be 100 characters or less';
    }

    if (lastName && lastName.length > 100) {
      errors.lastName = 'Last name must be 100 characters or less';
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (phone && phone.length > 50) {
      errors.phone = 'Phone must be 50 characters or less';
    }

    if (position && position.length > 150) {
      errors.position = 'Position must be 150 characters or less';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        firstName: firstName.trim(),
        source,
      };

      if (lastName.trim()) body.lastName = lastName.trim();
      else if (isEdit) body.lastName = null;

      if (email.trim()) body.email = email.trim();
      else if (isEdit) body.email = null;

      if (phone.trim()) body.phone = phone.trim();
      else if (isEdit) body.phone = null;

      if (position.trim()) body.position = position.trim();
      else if (isEdit) body.position = null;

      if (notes.trim()) body.notes = notes.trim();
      else if (isEdit) body.notes = null;

      if (isEdit) {
        await api(`/contacts/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        navigate(`/contacts/${id}`, { replace: true });
      } else {
        const created = await api<ContactData>('/contacts', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        navigate(`/contacts/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(getErrorMessage(err));
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <div>
        <PageHeader title={isEdit ? 'Edit Contact' : 'New Contact'} />
        <div className={styles.loadingState}>Loading contact...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Contact' : 'New Contact'}
        description={isEdit ? 'Update contact information' : 'Add a new contact to your CRM'}
      />

      <div className={styles.backLink}>
        <Link to={isEdit ? `/contacts/${id}` : '/contacts'} className={styles.back}>
          <ArrowLeft size={14} />
          {isEdit ? 'Back to Contact' : 'All Contacts'}
        </Link>
      </div>

      <Card className={styles.formCard}>
        <form ref={formRef} onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.alert}>
              <AlertCircle size={16} className={styles.alertIcon} />
              {error}
            </div>
          )}

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Basic Information</h3>
            <div className={styles.row}>
              <Input
                label="First Name"
                id="firstName"
                placeholder="John"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  clearFieldError('firstName');
                }}
                error={fieldErrors.firstName}
                required
                autoFocus
              />
              <Input
                label="Last Name"
                id="lastName"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  clearFieldError('lastName');
                }}
                error={fieldErrors.lastName}
              />
            </div>

            <Input
              label="Position"
              id="position"
              placeholder="Product Manager"
              value={position}
              onChange={(e) => {
                setPosition(e.target.value);
                clearFieldError('position');
              }}
              error={fieldErrors.position}
            />
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Contact Information</h3>
            <div className={styles.row}>
              <Input
                label="Email"
                id="email"
                type="email"
                placeholder="john@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError('email');
                }}
                error={fieldErrors.email}
              />
              <Input
                label="Phone"
                id="phone"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  clearFieldError('phone');
                }}
                error={fieldErrors.phone}
              />
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Additional Details</h3>
            <Select
              label="Source"
              value={source}
              onChange={(e) => setSource(e.target.value as ContactSource)}
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>

            <Textarea
              label="Notes"
              placeholder="Any additional notes about this contact..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>

          <div className={styles.formActions}>
            <Link to={isEdit ? `/contacts/${id}` : '/contacts'}>
              <Button type="button" variant="secondary" size="md">
                Cancel
              </Button>
            </Link>
            <Button type="submit" size="md" disabled={loading}>
              {loading
                ? isEdit
                  ? 'Saving...'
                  : 'Creating...'
                : isEdit
                  ? 'Save Changes'
                  : 'Create Contact'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
