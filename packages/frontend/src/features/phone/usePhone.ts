import { useContext } from 'react';
import { PhoneContext } from './PhoneProvider';
import type { PhoneContextValue } from './types';

export function usePhone(): PhoneContextValue {
  const ctx = useContext(PhoneContext);
  if (!ctx) {
    throw new Error('usePhone must be used within a PhoneProvider');
  }
  return ctx;
}
