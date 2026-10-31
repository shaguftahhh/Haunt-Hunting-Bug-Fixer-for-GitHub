/**
 * Small hook that asks the server whether an AI model is reachable.
 *
 * The UI needs this *before* someone clicks "Craft fix": without a model, only
 * deterministic "Quick fix" findings can produce a patch, and hiding that fact
 * turns a working feature into a confusing error.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ModelStatus } from './types';

interface UseModelStatus {
  status: ModelStatus | null;
  loading: boolean;
  error: unknown;
  refresh: () => void;
}

export function useModelStatus(): UseModelStatus {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .modelStatus()
      .then((result) => {
        if (!cancelled) {
          setStatus(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { status, loading, error, refresh };
}
