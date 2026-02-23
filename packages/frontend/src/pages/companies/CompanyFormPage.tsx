import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Input, Select, Textarea } from '../../ui';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/error-messages';
import styles from './CompanyFormPage.module.css';

interface CompanyData {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  industry: string | null;
  size: string | null;
  notes: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

const SIZE_OPTIONS = [
  { value: '', label: 'Select size...' },
  { value: '1-10', label: '1-10' },
  { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-500', label: '201-500' },
  { value: '501-1000', label: '501-1000' },
  { value: '1001-5000', label: '1001-5000' },
  { value: '5000+', label: '5000+' },
];

export function CompanyFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [size, setSize] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);

  useEffect(() => {
    if (!id) return;

    async function fetchCompany() {
      setFetching(true);
      try {
        const data = await api<CompanyData>(`/companies/${id}`);
        setName(data.name);
        setIndustry(data.industry || '');
        setSize(data.size || '');
        setPhone(data.phone || '');
        setWebsite(data.website || '');
        setAddress(data.address || '');
        setNotes(data.notes || '');
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setFetching(false);
      }
    }

    fetchCompany();
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

    if (!name.trim()) {
      errors.name = 'Company name is required';
    } else if (name.length > 200) {
      errors.name = 'Name must be 200 characters or less';
    }

    if (industry && industry.length > 100) {
      errors.industry = 'Industry must be 100 characters or less';
    }

    if (phone && phone.length > 50) {
      errors.phone = 'Phone must be 50 characters or less';
    }

    if (website && website.length > 500) {
      errors.website = 'Website must be 500 characters or less';
    }

    if (address && address.length > 500) {
      errors.address = 'Address must be 500 characters or less';
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
        name: name.trim(),
      };

      if (industry.trim()) body.industry = industry.trim();
      else if (isEdit) body.industry = null;

      if (size) body.size = size;
      else if (isEdit) body.size = null;

      if (phone.trim()) body.phone = phone.trim();
      else if (isEdit) body.phone = null;

      if (website.trim()) body.website = website.trim();
      else if (isEdit) body.website = null;

      if (address.trim()) body.address = address.trim();
      else if (isEdit) body.address = null;

      if (notes.trim()) body.notes = notes.trim();
      else if (isEdit) body.notes = null;

      if (isEdit) {
        await api(`/companies/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        navigate(`/companies/${id}`, { replace: true });
      } else {
        const created = await api<CompanyData>('/companies', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        navigate(`/companies/${created.id}`, { replace: true });
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
        <PageHeader title={isEdit ? 'Edit Company' : 'New Company'} />
        <div className={styles.loadingState}>Loading company...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Company' : 'New Company'}
        description={isEdit ? 'Update company information' : 'Add a new company to your CRM'}
      />

      <div className={styles.backLink}>
        <Link to={isEdit ? `/companies/${id}` : '/companies'} className={styles.back}>
          <ArrowLeft size={14} />
          {isEdit ? 'Back to Company' : 'All Companies'}
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
            <Input
              label="Company Name"
              id="name"
              placeholder="Acme Corp"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearFieldError('name');
              }}
              error={fieldErrors.name}
              required
              autoFocus
            />
            <div className={styles.row}>
              <Input
                label="Industry"
                id="industry"
                placeholder="Technology"
                value={industry}
                onChange={(e) => {
                  setIndustry(e.target.value);
                  clearFieldError('industry');
                }}
                error={fieldErrors.industry}
              />
              <Select
                label="Size"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Contact Information</h3>
            <div className={styles.row}>
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
              <Input
                label="Website"
                id="website"
                type="url"
                placeholder="https://example.com"
                value={website}
                onChange={(e) => {
                  setWebsite(e.target.value);
                  clearFieldError('website');
                }}
                error={fieldErrors.website}
              />
            </div>
            <Textarea
              label="Address"
              placeholder="Company address..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
            />
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Additional</h3>
            <Textarea
              label="Notes"
              placeholder="Any additional notes about this company..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>

          <div className={styles.formActions}>
            <Link to={isEdit ? `/companies/${id}` : '/companies'}>
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
                  : 'Create Company'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
