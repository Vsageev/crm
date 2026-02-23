import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Phone,
  Globe,
  MapPin,
  Calendar,
  Building2,
  Users,
} from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { useQuery, invalidateQueries } from '../../lib/useQuery';
import styles from './CompanyDetailPage.module.css';

interface Company {
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

interface CountResponse {
  total: number;
}

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: company, loading, error } = useQuery<Company>(
    id ? `/companies/${id}` : null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [dealCount, setDealCount] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;

    async function fetchCounts() {
      try {
        const [contacts, deals] = await Promise.all([
          api<CountResponse>(`/contacts?companyId=${id}&countOnly=true`),
          api<CountResponse>(`/deals?companyId=${id}&countOnly=true`),
        ]);
        setContactCount(contacts.total);
        setDealCount(deals.total);
      } catch {
        // counts are non-critical, silently fail
      }
    }

    fetchCounts();
  }, [id]);

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this company? This action cannot be undone.')) {
      return;
    }
    setDeleting(true);
    try {
      await api(`/companies/${id}`, { method: 'DELETE' });
      invalidateQueries('/companies');
      navigate('/companies', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setDeleteError(err.message);
      } else {
        setDeleteError('Failed to delete company');
      }
      setDeleting(false);
    }
  }

  function getInitial(name: string) {
    return (name[0] || '?').toUpperCase();
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Company" />
        <div className={styles.loadingState}>Loading company...</div>
      </div>
    );
  }

  const displayError = error || deleteError;

  if (displayError || !company) {
    return (
      <div>
        <PageHeader title="Company" />
        <Card>
          <div className={styles.errorState}>
            <p>{displayError || 'Company not found'}</p>
            <Link to="/companies">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                Back to Companies
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
        title={company.name}
        description={company.industry || undefined}
        actions={
          <div className={styles.actions}>
            <Link to={`/companies/${id}/edit`}>
              <Button variant="secondary" size="md">
                <Edit2 size={16} />
                Edit
              </Button>
            </Link>
            <Button variant="secondary" size="md" onClick={handleDelete} disabled={deleting}>
              <Trash2 size={16} />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        }
      />

      <div className={styles.backLink}>
        <Link to="/companies" className={styles.back}>
          <ArrowLeft size={14} />
          All Companies
        </Link>
      </div>

      <div className={styles.grid}>
        <Card>
          <div className={styles.profileSection}>
            <div className={styles.avatarLarge}>{getInitial(company.name)}</div>
            <div>
              <h2 className={styles.companyName}>{company.name}</h2>
              {company.industry && (
                <p className={styles.companyIndustry}>{company.industry}</p>
              )}
            </div>
          </div>

          <div className={styles.details}>
            {company.industry && (
              <div className={styles.detailRow}>
                <Building2 size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Industry</span>
                  <span className={styles.detailValue}>{company.industry}</span>
                </div>
              </div>
            )}

            {company.size && (
              <div className={styles.detailRow}>
                <Users size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Size</span>
                  <span className={styles.detailValue}>{company.size}</span>
                </div>
              </div>
            )}

            {company.phone && (
              <div className={styles.detailRow}>
                <Phone size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Phone</span>
                  <a href={`tel:${company.phone}`} className={styles.detailValue}>
                    {company.phone}
                  </a>
                </div>
              </div>
            )}

            {company.website && (
              <div className={styles.detailRow}>
                <Globe size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Website</span>
                  <a
                    href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.detailValue}
                  >
                    {company.website}
                  </a>
                </div>
              </div>
            )}

            {company.address && (
              <div className={styles.detailRow}>
                <MapPin size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Address</span>
                  <span className={styles.detailValue}>{company.address}</span>
                </div>
              </div>
            )}

            <div className={styles.detailRow}>
              <Calendar size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Created</span>
                <span className={styles.detailValue}>
                  {new Date(company.createdAt).toLocaleDateString('en-US', {
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
                  {new Date(company.updatedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {company.notes && (
          <Card>
            <h3 className={styles.sectionTitle}>Notes</h3>
            <p className={styles.notes}>{company.notes}</p>
          </Card>
        )}

        {(contactCount !== null || dealCount !== null) && (
          <Card>
            <h3 className={styles.sectionTitle}>Related</h3>
            <div className={styles.relatedCounts}>
              <Link to={`/contacts?companyId=${id}`} className={styles.relatedItem}>
                <span className={styles.relatedCount}>{contactCount ?? 0}</span>
                <span className={styles.relatedLabel}>Contacts</span>
              </Link>
              <Link to={`/deals?companyId=${id}`} className={styles.relatedItem}>
                <span className={styles.relatedCount}>{dealCount ?? 0}</span>
                <span className={styles.relatedLabel}>Deals</span>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
