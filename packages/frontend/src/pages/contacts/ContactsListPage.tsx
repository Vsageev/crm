import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronLeft, ChevronRight, Mail, Phone } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import type { ContactSource } from 'shared';
import styles from './ContactsListPage.module.css';

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
  createdAt: string;
  updatedAt: string;
}

interface ContactsResponse {
  total: number;
  limit: number;
  offset: number;
  entries: Contact[];
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

const PAGE_SIZE = 25;

export function ContactsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');

  const page = parseInt(searchParams.get('page') || '1', 10);
  const search = searchParams.get('search') || '';

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (search) params.set('search', search);

      const data = await api<ContactsResponse>(`/contacts?${params}`);
      setContacts(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load contacts');
      }
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

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

  function getContactName(c: Contact) {
    return [c.firstName, c.lastName].filter(Boolean).join(' ');
  }

  function getInitials(c: Contact) {
    const first = c.firstName?.[0] || '';
    const last = c.lastName?.[0] || '';
    return (first + last).toUpperCase() || '?';
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Manage your contacts and leads"
        actions={
          <Link to="/contacts/new">
            <Button size="md">
              <Plus size={16} />
              Add Contact
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
                placeholder="Search by name, email, or phone..."
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
                {total} contact{total !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.emptyState}>Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div className={styles.emptyState}>
            {search ? (
              <>
                <p>No contacts match your search.</p>
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
                <p>No contacts yet.</p>
                <Link to="/contacts/new">
                  <Button size="sm">
                    <Plus size={14} />
                    Add your first contact
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
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Position</th>
                    <th>Source</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <Link to={`/contacts/${contact.id}`} className={styles.nameCell}>
                          <span className={styles.avatar}>{getInitials(contact)}</span>
                          <span className={styles.name}>{getContactName(contact)}</span>
                        </Link>
                      </td>
                      <td>
                        {contact.email ? (
                          <span className={styles.contactInfo}>
                            <Mail size={14} />
                            {contact.email}
                          </span>
                        ) : (
                          <span className={styles.empty}>—</span>
                        )}
                      </td>
                      <td>
                        {contact.phone ? (
                          <span className={styles.contactInfo}>
                            <Phone size={14} />
                            {contact.phone}
                          </span>
                        ) : (
                          <span className={styles.empty}>—</span>
                        )}
                      </td>
                      <td>
                        {contact.position || <span className={styles.empty}>—</span>}
                      </td>
                      <td>
                        <Badge color={SOURCE_COLORS[contact.source]}>
                          {SOURCE_LABELS[contact.source]}
                        </Badge>
                      </td>
                      <td className={styles.dateCell}>
                        {new Date(contact.createdAt).toLocaleDateString()}
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
