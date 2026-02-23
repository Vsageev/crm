import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronLeft, ChevronRight, Phone, Globe } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './CompaniesListPage.module.css';

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

interface CompaniesResponse {
  total: number;
  limit: number;
  offset: number;
  entries: Company[];
}

const PAGE_SIZE = 25;

export function CompaniesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');

  const page = parseInt(searchParams.get('page') || '1', 10);
  const search = searchParams.get('search') || '';

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (search) params.set('search', search);

      const data = await api<CompaniesResponse>(`/companies?${params}`);
      setCompanies(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load companies');
      }
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (searchInput) {
        next.set('search', searchInput);
      } else {
        next.delete('search');
      }
      next.set('page', '1');
      return next;
    });
  }

  function goToPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  }

  function getInitial(name: string) {
    return (name[0] || '?').toUpperCase();
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Manage your company accounts"
        actions={
          <Link to="/companies/new">
            <Button size="md">
              <Plus size={16} />
              Add Company
            </Button>
          </Link>
        }
      />

      <Card>
        <div className={styles.toolbar}>
          <form onSubmit={handleSearch} className={styles.searchForm}>
            <div className={styles.searchInputWrap}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search by name, website, or phone..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>
          <div className={styles.meta}>
            {!loading && (
              <span className={styles.count}>
                {total} compan{total !== 1 ? 'ies' : 'y'}
              </span>
            )}
          </div>
        </div>

        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.emptyState}>Loading companies...</div>
        ) : companies.length === 0 ? (
          <div className={styles.emptyState}>
            {search ? (
              <>
                <p>No companies match your search.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchInput('');
                    setSearchParams({});
                  }}
                >
                  Clear search
                </Button>
              </>
            ) : (
              <>
                <p>No companies yet.</p>
                <Link to="/companies/new">
                  <Button size="sm">
                    <Plus size={14} />
                    Add your first company
                  </Button>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Industry</th>
                    <th>Size</th>
                    <th>Phone</th>
                    <th>Website</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <Link to={`/companies/${company.id}`} className={styles.nameCell}>
                          <span className={styles.avatar}>{getInitial(company.name)}</span>
                          <span className={styles.name}>{company.name}</span>
                        </Link>
                      </td>
                      <td>
                        {company.industry || <span className={styles.empty}>—</span>}
                      </td>
                      <td>
                        {company.size || <span className={styles.empty}>—</span>}
                      </td>
                      <td>
                        {company.phone ? (
                          <span className={styles.contactInfo}>
                            <Phone size={14} />
                            {company.phone}
                          </span>
                        ) : (
                          <span className={styles.empty}>—</span>
                        )}
                      </td>
                      <td>
                        {company.website ? (
                          <span className={styles.contactInfo}>
                            <Globe size={14} />
                            {company.website}
                          </span>
                        ) : (
                          <span className={styles.empty}>—</span>
                        )}
                      </td>
                      <td className={styles.dateCell}>
                        {new Date(company.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  <ChevronLeft size={14} />
                  Previous
                </Button>
                <span className={styles.pageInfo}>
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                  <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
