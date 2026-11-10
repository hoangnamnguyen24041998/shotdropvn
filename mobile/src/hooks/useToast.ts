import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastMessage } from '../types';

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (type: 'success' | 'error' | 'info', message: string, durationMs = 3500) => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      const id = Date.now();
      setToast({ id, type, message });
      toastTimeoutRef.current = setTimeout(() => {
        setToast((curr) => (curr?.id === id ? null : curr));
      }, durationMs);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  return { toast, showToast };
}
