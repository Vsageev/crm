import { useState, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Pause,
  Play,
  X,
  ChevronDown,
} from 'lucide-react';
import { usePhone } from './usePhone';
import styles from './SoftphoneWidget.module.css';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function SoftphoneWidget() {
  const {
    providers,
    callState,
    selectedProviderId,
    setSelectedProviderId,
    makeCall,
    endCall,
    toggleMute,
    toggleHold,
  } = usePhone();

  const [dialOpen, setDialOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (providers.length === 0) return null;

  const isIdle = callState.status === 'idle';
  const isActive = callState.status === 'dialing' || callState.status === 'ringing' || callState.status === 'connected';
  const isEnded = callState.status === 'ended';

  async function handleCall() {
    if (!phoneInput.trim()) return;
    setError('');
    try {
      await makeCall(phoneInput.trim());
      setDialOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Call failed');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCall();
    }
    if (e.key === 'Escape') {
      setDialOpen(false);
    }
  }

  return (
    <div className={styles.root}>
      {/* Active / ended call bar */}
      {(isActive || isEnded) && (
        <div className={styles.callBar}>
          <div className={styles.callBarInfo}>
            <span className={`${styles.callDot} ${callState.status === 'connected' ? styles.callDotConnected : styles.callDotDialing}`} />
            <div className={styles.callBarText}>
              <span className={styles.callBarName}>
                {callState.contactName || callState.phoneNumber}
              </span>
              <span className={styles.callBarStatus}>
                {callState.status === 'dialing' && 'Dialing...'}
                {callState.status === 'ringing' && 'Ringing...'}
                {callState.status === 'connected' && formatDuration(callState.duration)}
                {callState.status === 'ended' && 'Ended'}
              </span>
            </div>
          </div>
          {isActive && (
            <div className={styles.callBarActions}>
              <button
                className={`${styles.callBarBtn} ${callState.isMuted ? styles.callBarBtnActive : ''}`}
                onClick={toggleMute}
                title={callState.isMuted ? 'Unmute' : 'Mute'}
              >
                {callState.isMuted ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
              <button
                className={`${styles.callBarBtn} ${callState.isOnHold ? styles.callBarBtnActive : ''}`}
                onClick={toggleHold}
                title={callState.isOnHold ? 'Resume' : 'Hold'}
              >
                {callState.isOnHold ? <Play size={14} /> : <Pause size={14} />}
              </button>
              <button
                className={styles.callBarEndBtn}
                onClick={endCall}
                title="End call"
              >
                <PhoneOff size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Idle: phone button + dial popover */}
      {isIdle && (
        <div className={styles.dialAnchor}>
          <button
            className={styles.phoneBtn}
            onClick={() => {
              setDialOpen((v) => !v);
              if (!dialOpen) setTimeout(() => inputRef.current?.focus(), 80);
            }}
          >
            <Phone size={18} />
            <span>Phone</span>
          </button>

          {dialOpen && (
            <div className={styles.dialPopover}>
              <div className={styles.dialHeader}>
                <span className={styles.dialTitle}>New call</span>
                <button className={styles.dialCloseBtn} onClick={() => setDialOpen(false)}>
                  <X size={14} />
                </button>
              </div>
              <div className={styles.dialBody}>
                <input
                  ref={inputRef}
                  type="tel"
                  className={styles.dialInput}
                  placeholder="+7 (999) 123-45-67"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                {providers.length > 1 && (
                  <div className={styles.providerSelect}>
                    <select
                      value={selectedProviderId || ''}
                      onChange={(e) => setSelectedProviderId(e.target.value || null)}
                      className={styles.providerDropdown}
                    >
                      <option value="">Select provider</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className={styles.selectChevron} />
                  </div>
                )}
                <button
                  className={styles.dialCallBtn}
                  onClick={handleCall}
                  disabled={!phoneInput.trim() || (providers.length > 1 && !selectedProviderId)}
                >
                  <Phone size={14} />
                  Call
                </button>
                {error && <div className={styles.dialError}>{error}</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
