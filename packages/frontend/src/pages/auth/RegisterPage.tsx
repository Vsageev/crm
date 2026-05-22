import { type FormEvent, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from '../../ui';
import { useAuth } from '../../stores/useAuth';
import { getErrorMessage } from '../../lib/error-messages';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import {
  getPasswordRequirementChecks,
  getRegisterPasswordFieldError,
} from '../../lib/register-password-validation';
import styles from './RegisterPage.module.css';

type StrengthLevel = 'weak' | 'medium' | 'strong';

function getPasswordStrength(password: string): { level: StrengthLevel; score: number } {
  if (!password) return { level: 'weak', score: 0 };

  const checks = getPasswordRequirementChecks(password);
  const metCount = checks.filter((check) => check.met).length;

  if (metCount <= 1) return { level: 'weak', score: 1 };
  if (metCount <= 3) return { level: 'medium', score: 2 };
  return { level: 'strong', score: 3 };
}

const strengthLabels: Record<StrengthLevel, string> = {
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong',
};

export function RegisterPage() {
  useDocumentTitle('Create Account');
  const { register } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const requirements = useMemo(() => getPasswordRequirementChecks(password), [password]);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (firstName.trim().length === 0) errors.firstName = 'First name is required';
    if (lastName.trim().length === 0) errors.lastName = 'Last name is required';
    if (!email.trim()) errors.email = 'Email is required';

    const passwordError = getRegisterPasswordFieldError(password);
    if (passwordError) errors.password = passwordError;

    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await register({ email, password, firstName: firstName.trim(), lastName: lastName.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>Start organizing your workspace in seconds</p>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <svg className={styles.errorIcon} viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.nameRow}>
          <div className={styles.fieldGroup}>
            <Input
              label="First name"
              type="text"
              placeholder="Jane"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={fieldErrors.firstName}
              required
              autoComplete="given-name"
              autoFocus
            />
          </div>
          <div className={styles.fieldGroup}>
            <Input
              label="Last name"
              type="text"
              placeholder="Doe"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={fieldErrors.lastName}
              required
              autoComplete="family-name"
            />
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <Input
            label="Email address"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            required
            autoComplete="email"
          />
        </div>

        <div className={styles.fieldGroup}>
          <Input
            label="Password"
            type="password"
            placeholder="Create a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            required
            autoComplete="new-password"
          />
        </div>

        {password.length > 0 && (
          <div className={styles.strengthSection}>
            <div className={styles.strengthBar}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={styles.strengthSegment}
                  data-active={i <= strength.score}
                  data-level={strength.level}
                />
              ))}
            </div>
            <span className={styles.strengthLabel} data-level={strength.level}>
              {strengthLabels[strength.level]}
            </span>
            <div className={styles.requirements}>
              {requirements.map((req) => (
                <span key={req.id} className={styles.requirement} data-met={req.met}>
                  <svg
                    className={styles.requirementIcon}
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={req.met ? 2 : 1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {req.met ? (
                      <polyline points="2.5 7 5.5 10 11.5 4" />
                    ) : (
                      <circle cx="7" cy="7" r="3" />
                    )}
                  </svg>
                  {req.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={styles.fieldGroup}>
          <Input
            label="Confirm password"
            type="password"
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={fieldErrors.confirmPassword}
            required
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" size="lg" disabled={loading} className={styles.submitButton}>
          {loading ? (
            <span className={styles.loadingContent}>
              <span className={styles.spinner} />
              Creating account...
            </span>
          ) : (
            'Create account'
          )}
        </Button>
      </form>

      <div className={styles.divider}>
        <span>or</span>
      </div>

      <p className={styles.footer}>
        Already have an account?{' '}
        <Link to="/login" className={styles.link}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
