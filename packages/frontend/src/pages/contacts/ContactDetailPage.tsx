import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Mail,
  Phone,
  Briefcase,
  Calendar,
  User,
  Globe,
  Download,
} from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Badge } from '../../ui';
import { api, ApiError, getAccessToken } from '../../lib/api';
import { useQuery, invalidateQueries } from '../../lib/useQuery';
import type { ContactSource } from 'shared';
import { ActivityTimeline } from './ActivityTimeline';
import styles from './ContactDetailPage.module.css';

interface Contact {
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
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  referrerUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

const SOURCE_LABELS: Record<ContactSource, string> = {
  manual: 'Manual',
  csv_import: 'CSV Import',
  web_form: 'Web Form',
  telegram: 'Telegram',
  email: 'Email',
  api: 'API',
  other: 'Other',
};

const SOURCE_COLORS: Record<ContactSource, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  manual: 'default',
  csv_import: 'info',
  web_form: 'success',
  telegram: 'info',
  email: 'warning',
  api: 'default',
  other: 'default',
};

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: contact, loading, error } = useQuery<Contact>(
    id ? `/contacts/${id}` : null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [exporting, setExporting] = useState(false);

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this contact? This action cannot be undone.')) {
      return;
    }
    setDeleting(true);
    try {
      await api(`/contacts/${id}`, { method: 'DELETE' });
      invalidateQueries('/contacts');
      navigate('/contacts', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setDeleteError(err.message);
      } else {
        setDeleteError('Failed to delete contact');
      }
      setDeleting(false);
    }
  }

  async function handleGdprExport() {
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/contacts/${id}/export/gdpr`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error('Export failed');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] ?? `gdpr_export_${id}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDeleteError('Failed to export GDPR data');
    } finally {
      setExporting(false);
    }
  }

  function getContactName(c: Contact) {
    return [c.firstName, c.lastName].filter(Boolean).join(' ');
  }

  function getInitials(c: Contact) {
    const first = c.firstName?.[0] || '';
    const last = c.lastName?.[0] || '';
    return (first + last).toUpperCase() || '?';
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Contact" />
        <div className={styles.loadingState}>Loading contact...</div>
      </div>
    );
  }

  const displayError = error || deleteError;

  if (displayError || !contact) {
    return (
      <div>
        <PageHeader title="Contact" />
        <Card>
          <div className={styles.errorState}>
            <p>{displayError || 'Contact not found'}</p>
            <Link to="/contacts">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                Back to Contacts
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={getContactName(contact)}
        description={contact.position || undefined}
        actions={
          <div className={styles.actions}>
            <Link to={`/contacts/${id}/edit`}>
              <Button variant="secondary" size="md">
                <Edit2 size={16} />
                Edit
              </Button>
            </Link>
            <Button variant="secondary" size="md" onClick={handleGdprExport} disabled={exporting}>
              <Download size={16} />
              {exporting ? 'Exporting...' : 'GDPR Export'}
            </Button>
            <Button variant="secondary" size="md" onClick={handleDelete} disabled={deleting}>
              <Trash2 size={16} />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        }
      />

      <div className={styles.backLink}>
        <Link to="/contacts" className={styles.back}>
          <ArrowLeft size={14} />
          All Contacts
        </Link>
      </div>

      <div className={styles.grid}>
        <Card>
          <div className={styles.profileSection}>
            <div className={styles.avatarLarge}>{getInitials(contact)}</div>
            <div>
              <h2 className={styles.contactName}>{getContactName(contact)}</h2>
              {contact.position && (
                <p className={styles.contactPosition}>{contact.position}</p>
              )}
              <Badge color={SOURCE_COLORS[contact.source]}>
                {SOURCE_LABELS[contact.source]}
              </Badge>
            </div>
          </div>

          <div className={styles.details}>
            {contact.email && (
              <div className={styles.detailRow}>
                <Mail size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Email</span>
                  <a href={`mailto:${contact.email}`} className={styles.detailValue}>
                    {contact.email}
                  </a>
                </div>
              </div>
            )}

            {contact.phone && (
              <div className={styles.detailRow}>
                <Phone size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Phone</span>
                  <a href={`tel:${contact.phone}`} className={styles.detailValue}>
                    {contact.phone}
                  </a>
                </div>
              </div>
            )}

            {contact.position && (
              <div className={styles.detailRow}>
                <Briefcase size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Position</span>
                  <span className={styles.detailValue}>{contact.position}</span>
                </div>
              </div>
            )}

            <div className={styles.detailRow}>
              <User size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Source</span>
                <span className={styles.detailValue}>{SOURCE_LABELS[contact.source]}</span>
              </div>
            </div>

            <div className={styles.detailRow}>
              <Calendar size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Created</span>
                <span className={styles.detailValue}>
                  {new Date(contact.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>

            <div className={styles.detailRow}>
              <Calendar size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Last Updated</span>
                <span className={styles.detailValue}>
                  {new Date(contact.updatedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {contact.notes && (
          <Card>
            <h3 className={styles.sectionTitle}>Notes</h3>
            <p className={styles.notes}>{contact.notes}</p>
          </Card>
        )}

        {(contact.utmSource || contact.utmMedium || contact.utmCampaign || contact.referrerUrl) && (
          <Card>
            <h3 className={styles.sectionTitle}>
              <Globe size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Lead Source
            </h3>
            <div className={styles.utmGrid}>
              {contact.utmSource && (
                <div className={styles.utmItem}>
                  <span className={styles.utmLabel}>Source</span>
                  <span className={styles.utmValue}>{contact.utmSource}</span>
                </div>
              )}
              {contact.utmMedium && (
                <div className={styles.utmItem}>
                  <span className={styles.utmLabel}>Medium</span>
                  <span className={styles.utmValue}>{contact.utmMedium}</span>
                </div>
              )}
              {contact.utmCampaign && (
                <div className={styles.utmItem}>
                  <span className={styles.utmLabel}>Campaign</span>
                  <span className={styles.utmValue}>{contact.utmCampaign}</span>
                </div>
              )}
              {contact.utmTerm && (
                <div className={styles.utmItem}>
                  <span className={styles.utmLabel}>Term</span>
                  <span className={styles.utmValue}>{contact.utmTerm}</span>
                </div>
              )}
              {contact.utmContent && (
                <div className={styles.utmItem}>
                  <span className={styles.utmLabel}>Content</span>
                  <span className={styles.utmValue}>{contact.utmContent}</span>
                </div>
              )}
              {contact.referrerUrl && (
                <div className={styles.utmItem}>
                  <span className={styles.utmLabel}>Referrer</span>
                  <span className={styles.utmValue}>{contact.referrerUrl}</span>
                </div>
              )}
            </div>
          </Card>
        )}

        <Card>
          <ActivityTimeline contactId={id!} />
        </Card>
      </div>
    </div>
  );
}
