import { useSyncExternalStore } from 'react';

export type ToastVariant = 'error' | 'success' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

let nextId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastItem[] {
  return toasts;
}

export function showToast(message: string, variant: ToastVariant = 'info', duration = 5000) {
  const id = nextId++;
  toasts = [...toasts, { id, message, variant }];
  notify();

  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export const toast = {
  error: (message: string) => showToast(message, 'error'),
  success: (message: string) => showToast(message, 'success'),
  info: (message: string) => showToast(message, 'info'),
};

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
