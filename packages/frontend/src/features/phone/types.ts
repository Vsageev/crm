export type CallStatus = 'idle' | 'dialing' | 'ringing' | 'connected' | 'ended';

export interface TelephonyProvider {
  id: string;
  provider: 'novofon' | 'voximplant';
  name: string;
}

export interface CallState {
  status: CallStatus;
  phoneNumber: string;
  contactName: string | null;
  contactId: string | null;
  providerId: string | null;
  providerType: 'novofon' | 'voximplant' | null;
  duration: number;
  isMuted: boolean;
  isOnHold: boolean;
  direction: 'outbound' | 'inbound';
}

export interface PhoneContextValue {
  providers: TelephonyProvider[];
  callState: CallState;
  selectedProviderId: string | null;
  setSelectedProviderId: (id: string | null) => void;
  makeCall: (phoneNumber: string, contactName?: string, contactId?: string) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  answerCall: () => void;
  declineCall: () => void;
}
