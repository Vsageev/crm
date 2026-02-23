import { Phone, PhoneOff } from 'lucide-react';
import { usePhone } from './usePhone';
import styles from './IncomingCallBanner.module.css';

export function IncomingCallBanner() {
  const { callState, answerCall, declineCall } = usePhone();

  if (callState.status !== 'ringing' || callState.direction !== 'inbound') {
    return null;
  }

  return (
    <div className={styles.banner}>
      <div className={styles.info}>
        <div className={styles.label}>Incoming call</div>
        <div className={styles.caller}>
          {callState.contactName || callState.phoneNumber}
        </div>
        {callState.contactName && (
          <div className={styles.number}>{callState.phoneNumber}</div>
        )}
      </div>
      <div className={styles.actions}>
        <button className={styles.answerBtn} onClick={answerCall} title="Answer">
          <Phone size={18} />
        </button>
        <button className={styles.declineBtn} onClick={declineCall} title="Decline">
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
