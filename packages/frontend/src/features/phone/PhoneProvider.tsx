import { createContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { api } from '../../lib/api';
import type { CallState, TelephonyProvider, PhoneContextValue } from './types';
import type { Client as VoxClient } from 'voximplant-websdk/Client';
import type { Call as VoxCall } from 'voximplant-websdk/Call/Call';

type VoxModule = typeof import('voximplant-websdk');

interface VoxLoginCredentials {
  loginUrl: string;
  password: string;
  userName: string;
  accountName: string;
  callerId?: string | null;
}

const INITIAL_CALL_STATE: CallState = {
  status: 'idle',
  phoneNumber: '',
  contactName: null,
  contactId: null,
  providerId: null,
  providerType: null,
  duration: 0,
  isMuted: false,
  isOnHold: false,
  direction: 'outbound',
};

const CALLBACK_CONNECT_DELAY_MS = 3000;
const WEB_RINGING_DELAY_MS = 1500;

export const PhoneContext = createContext<PhoneContextValue | null>(null);

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<TelephonyProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>(INITIAL_CALL_STATE);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const voxModuleRef = useRef<VoxModule | null>(null);
  const voxClientRef = useRef<VoxClient | null>(null);
  const voxCallRef = useRef<VoxCall | null>(null);
  const voxInitializedRef = useRef(false);
  const voxAuthProviderIdRef = useRef<string | null>(null);
  const voxAuthPromiseRef = useRef<Promise<{ module: VoxModule; client: VoxClient }> | null>(null);
  const voxCredentialsRef = useRef<VoxLoginCredentials | null>(null);

  const clearTransitionTimeout = useCallback(() => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await api<{ providers: TelephonyProvider[] }>('/telephony/providers');
      setProviders(data.providers);

      if (data.providers.length === 1) {
        setSelectedProviderId(data.providers[0].id);
        return;
      }

      if (selectedProviderId && !data.providers.some((p) => p.id === selectedProviderId)) {
        setSelectedProviderId(null);
      }
    } catch {
      setProviders([]);
    }
  }, [selectedProviderId]);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    if (callState.status === 'connected') {
      timerRef.current = setInterval(() => {
        setCallState((prev) => ({ ...prev, duration: prev.duration + 1 }));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [callState.status]);

  useEffect(() => {
    if (callState.status === 'ended') {
      endTimeoutRef.current = setTimeout(() => {
        setCallState(INITIAL_CALL_STATE);
      }, 3000);
    }

    return () => {
      if (endTimeoutRef.current) {
        clearTimeout(endTimeoutRef.current);
        endTimeoutRef.current = null;
      }
    };
  }, [callState.status]);

  useEffect(() => {
    return () => {
      clearTransitionTimeout();

      const activeCall = voxCallRef.current;
      if (activeCall) {
        try {
          activeCall.hangup();
        } catch {
          // no-op
        }
      }

      const client = voxClientRef.current;
      if (client) {
        void client.disconnect().catch(() => {
          // no-op
        });
      }
    };
  }, [clearTransitionTimeout]);

  const getSelectedProvider = useCallback((): TelephonyProvider | null => {
    if (selectedProviderId) {
      return providers.find((p) => p.id === selectedProviderId) ?? null;
    }
    if (providers.length === 1) return providers[0];
    return null;
  }, [providers, selectedProviderId]);

  const markCallbackRinging = useCallback(() => {
    setCallState((prev) => ({ ...prev, status: 'ringing' }));

    clearTransitionTimeout();
    transitionTimeoutRef.current = setTimeout(() => {
      setCallState((prev) => {
        if (prev.status === 'ringing') {
          return { ...prev, status: 'connected' };
        }
        return prev;
      });
    }, CALLBACK_CONNECT_DELAY_MS);
  }, [clearTransitionTimeout]);

  const markWebDialing = useCallback(() => {
    clearTransitionTimeout();
    transitionTimeoutRef.current = setTimeout(() => {
      setCallState((prev) => {
        if (prev.status === 'dialing') {
          return { ...prev, status: 'ringing' };
        }
        return prev;
      });
    }, WEB_RINGING_DELAY_MS);
  }, [clearTransitionTimeout]);

  const makeNovofonCall = useCallback(async (provider: TelephonyProvider, phoneNumber: string) => {
    await api(`/novofon/accounts/${provider.id}/call`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber }),
    });

    // Novofon callback: PBX calls the agent endpoint, then dials destination.
    markCallbackRinging();
  }, [markCallbackRinging]);

  const ensureVoxClient = useCallback(async (): Promise<{ module: VoxModule; client: VoxClient }> => {
    if (!voxModuleRef.current) {
      voxModuleRef.current = await import('voximplant-websdk');
    }

    const module = voxModuleRef.current;

    if (!voxClientRef.current) {
      voxClientRef.current = module.getInstance();
    }

    const client = voxClientRef.current;

    if (!voxInitializedRef.current) {
      await client.init({
        micRequired: true,
        progressTone: true,
        progressToneCountry: 'US',
      });
      voxInitializedRef.current = true;
    }

    return { module, client };
  }, []);

  const ensureVoxAuthorized = useCallback(async (providerId: string): Promise<{ module: VoxModule; client: VoxClient }> => {
    if (voxAuthPromiseRef.current) {
      return voxAuthPromiseRef.current;
    }

    const promise = (async () => {
      const { module, client } = await ensureVoxClient();

      // Re-auth if user switches between different Vox accounts.
      if (voxAuthProviderIdRef.current && voxAuthProviderIdRef.current !== providerId) {
        try {
          await client.disconnect();
        } catch {
          // no-op
        }
        voxAuthProviderIdRef.current = null;
      }

      if (client.getClientState() === module.ClientState.DISCONNECTED) {
        const connected = await client.connect();
        if (!connected) {
          throw new Error('Failed to connect Voximplant Web SDK');
        }
      }

      if (client.getClientState() !== module.ClientState.LOGGED_IN) {
        const credentials = await api<VoxLoginCredentials>(`/voximplant/accounts/${providerId}/login-credentials`);
        if (!credentials.loginUrl || !credentials.password) {
          throw new Error('Voximplant login credentials are missing');
        }
        voxCredentialsRef.current = credentials;

        const auth = await client.login(credentials.loginUrl, credentials.password);
        if (!auth.result) {
          const codeSuffix = typeof auth.code === 'number' ? ` (${auth.code})` : '';
          throw new Error(`Voximplant authorization failed${codeSuffix}`);
        }
      }

      voxAuthProviderIdRef.current = providerId;
      return { module, client };
    })();

    voxAuthPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (voxAuthPromiseRef.current === promise) {
        voxAuthPromiseRef.current = null;
      }
    }
  }, [ensureVoxClient]);

  const attachVoxCallHandlers = useCallback((call: VoxCall, module: VoxModule) => {
    call.on(module.CallEvents.ProgressToneStart, () => {
      setCallState((prev) => {
        if (prev.status === 'dialing') {
          return { ...prev, status: 'ringing' };
        }
        return prev;
      });
    });

    call.on(module.CallEvents.Connected, () => {
      clearTransitionTimeout();
      setCallState((prev) => {
        if (prev.status === 'dialing' || prev.status === 'ringing') {
          return { ...prev, status: 'connected' };
        }
        return prev;
      });
    });

    call.on(module.CallEvents.Disconnected, () => {
      clearTransitionTimeout();
      voxCallRef.current = null;
      setCallState((prev) => (prev.status === 'idle' ? prev : { ...prev, status: 'ended' }));
    });

    call.on(module.CallEvents.Failed, () => {
      clearTransitionTimeout();
      voxCallRef.current = null;
      setCallState((prev) => (prev.status === 'idle' ? prev : { ...prev, status: 'ended' }));
    });
  }, [clearTransitionTimeout]);

  const makeVoximplantWebCall = useCallback(async (provider: TelephonyProvider, phoneNumber: string) => {
    const { module, client } = await ensureVoxAuthorized(provider.id);
    const callerId =
      typeof voxCredentialsRef.current?.callerId === 'string' && voxCredentialsRef.current.callerId.trim()
        ? voxCredentialsRef.current.callerId.trim()
        : null;
    const call = client.call({
      number: phoneNumber,
      video: false,
      customData: JSON.stringify({
        phoneNumber,
        callerId,
      }),
    });
    voxCallRef.current = call;
    attachVoxCallHandlers(call, module);
    markWebDialing();
  }, [ensureVoxAuthorized, attachVoxCallHandlers, markWebDialing]);

  const makeVoximplantCallbackCall = useCallback(async (provider: TelephonyProvider, phoneNumber: string) => {
    await api(`/voximplant/accounts/${provider.id}/call`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber }),
    });

    markCallbackRinging();
  }, [markCallbackRinging]);

  const makeVoximplantCall = useCallback(async (provider: TelephonyProvider, phoneNumber: string) => {
    try {
      await makeVoximplantWebCall(provider, phoneNumber);
    } catch {
      await makeVoximplantCallbackCall(provider, phoneNumber);
    }
  }, [makeVoximplantWebCall, makeVoximplantCallbackCall]);

  const makeCall = useCallback(async (phoneNumber: string, contactName?: string, contactId?: string) => {
    const provider = getSelectedProvider();
    if (!provider) throw new Error('No telephony provider selected');
    if (callState.status !== 'idle') throw new Error('A call is already active');

    setCallState({
      status: 'dialing',
      phoneNumber,
      contactName: contactName ?? null,
      contactId: contactId ?? null,
      providerId: provider.id,
      providerType: provider.provider,
      duration: 0,
      isMuted: false,
      isOnHold: false,
      direction: 'outbound',
    });

    try {
      if (provider.provider === 'novofon') {
        await makeNovofonCall(provider, phoneNumber);
      } else {
        await makeVoximplantCall(provider, phoneNumber);
      }
    } catch (err) {
      clearTransitionTimeout();
      setCallState(INITIAL_CALL_STATE);
      throw err instanceof Error ? err : new Error('Failed to start call');
    }
  }, [getSelectedProvider, callState.status, makeNovofonCall, makeVoximplantCall, clearTransitionTimeout]);

  const endCall = useCallback(() => {
    clearTransitionTimeout();

    const voxCall = voxCallRef.current;
    if (voxCall) {
      try {
        voxCall.hangup();
      } catch {
        // no-op
      }
      voxCallRef.current = null;
    }

    setCallState((prev) => ({ ...prev, status: 'ended' }));
  }, [clearTransitionTimeout]);

  const toggleMute = useCallback(() => {
    setCallState((prev) => {
      const nextMuted = !prev.isMuted;

      if (prev.providerType === 'voximplant' && voxCallRef.current) {
        try {
          if (nextMuted) {
            voxCallRef.current.muteMicrophone();
          } else {
            voxCallRef.current.unmuteMicrophone();
          }
        } catch {
          // no-op
        }
      }

      return { ...prev, isMuted: nextMuted };
    });
  }, []);

  const toggleHold = useCallback(() => {
    setCallState((prev) => {
      const nextOnHold = !prev.isOnHold;

      if (prev.providerType === 'voximplant' && voxCallRef.current) {
        void voxCallRef.current.setActive(!nextOnHold).catch(() => {
          // no-op
        });
      }

      return { ...prev, isOnHold: nextOnHold };
    });
  }, []);

  const answerCall = useCallback(() => {
    setCallState((prev) => {
      if (prev.status === 'ringing') {
        return { ...prev, status: 'connected' };
      }
      return prev;
    });
  }, []);

  const declineCall = useCallback(() => {
    clearTransitionTimeout();

    const voxCall = voxCallRef.current;
    if (voxCall) {
      try {
        voxCall.hangup();
      } catch {
        // no-op
      }
      voxCallRef.current = null;
    }

    setCallState(INITIAL_CALL_STATE);
  }, [clearTransitionTimeout]);

  const value: PhoneContextValue = {
    providers,
    callState,
    selectedProviderId,
    setSelectedProviderId,
    makeCall,
    endCall,
    toggleMute,
    toggleHold,
    answerCall,
    declineCall,
  };

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}
