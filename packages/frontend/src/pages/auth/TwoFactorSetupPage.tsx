import { type FormEvent, type KeyboardEvent, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, CheckCircle } from 'lucide-react';
import { Button, Card } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './AuthPage.module.css';

interface TotpSetup {
  qrCodeUrl: string;
  secret: string;
}

type Step = 'generate' | 'verify' | 'done';

export function TwoFactorSetupPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('generate');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleGenerate = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await api<TotpSetup>('/auth/2fa/setup', { method: 'POST' });
      setSetup(data);
      setStep('verify');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to generate 2FA secret. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  function handleCodeChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;

    const digit = value.slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const next = [...code];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setCode(next);

    const focusIndex = Math.min(pasted.length, 5);
    inputRefs.current[focusIndex]?.focus();
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    const token = code.join('');
    if (token.length !== 6) {
      setError('Please enter the full 6-digit code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await api('/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Invalid code. Please try again.');
      }
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <Card>
        <div className={styles.form}>
          <div className={styles.successMessage}>
            <div className={styles.successIcon}>
              <CheckCircle size={24} />
            </div>
            <h1 className={styles.title}>2FA enabled</h1>
            <p className={styles.subtitle}>
              Your account is now protected with two-factor authentication.
            </p>
          </div>
          <Button size="lg" onClick={() => navigate('/settings', { replace: true })}>
            Go to Settings
          </Button>
        </div>
      </Card>
    );
  }

  if (step === 'generate') {
    return (
      <Card>
        <div className={styles.form}>
          <div className={styles.stepIndicator}>
            <span className={`${styles.step} ${styles.stepActive}`} />
            <span className={styles.step} />
          </div>
          <div className={styles.header}>
            <h1 className={styles.title}>Two-factor authentication</h1>
            <p className={styles.subtitle}>
              Add an extra layer of security to your account using an authenticator app.
            </p>
          </div>

          {error && <div className={styles.alert}>{error}</div>}

          <Button size="lg" onClick={handleGenerate} disabled={loading}>
            <ShieldCheck size={18} />
            {loading ? 'Setting up...' : 'Set up 2FA'}
          </Button>

          <Button variant="ghost" size="lg" onClick={() => navigate(-1)}>
            Skip for now
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleVerify} className={styles.form}>
        <div className={styles.stepIndicator}>
          <span className={`${styles.step} ${styles.stepActive}`} />
          <span className={`${styles.step} ${styles.stepActive}`} />
        </div>
        <div className={styles.header}>
          <h1 className={styles.title}>Scan QR code</h1>
          <p className={styles.subtitle}>
            Scan this code with your authenticator app (Google Authenticator, Authy, etc.)
          </p>
        </div>

        {error && <div className={styles.alert}>{error}</div>}

        {setup && (
          <div className={styles.qrContainer}>
            <div className={styles.qrPlaceholder}>
              <img
                src={setup.qrCodeUrl}
                alt="2FA QR Code"
                width={180}
                height={180}
              />
            </div>
            <p className={styles.hint}>Or enter this key manually:</p>
            <code className={styles.secretKey}>{setup.secret}</code>
          </div>
        )}

        <div className={styles.divider}>Verification code</div>

        <div className={styles.codeInputs} onPaste={handlePaste}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleCodeChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              autoFocus={i === 0}
            />
          ))}
        </div>

        <p className={styles.hint}>
          Enter the 6-digit code from your authenticator app to complete setup.
        </p>

        <Button type="submit" size="lg" disabled={loading || code.join('').length !== 6}>
          {loading ? 'Verifying...' : 'Verify and enable'}
        </Button>

        <Button variant="ghost" size="lg" type="button" onClick={() => setStep('generate')}>
          Back
        </Button>
      </form>
    </Card>
  );
}
