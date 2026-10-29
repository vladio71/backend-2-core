// Хук для панелі: тримає останній обмін (запит + відповідь + час) і прапорець "у польоті".
// track(apiCall(...)) записує результат, повертає його ж, щоб сторінка могла далі працювати з тілом.
import { useCallback, useState } from 'react';
import { ApiExchange } from '../api/client';

export interface LatencyState {
  exchange: ApiExchange | null;
  busy: boolean;
  history: ApiExchange[];
  track: (call: Promise<ApiExchange>) => Promise<ApiExchange>;
  reset: () => void;
}

export function useLatency(historySize = 20): LatencyState {
  const [exchange, setExchange] = useState<ApiExchange | null>(null);
  const [history, setHistory] = useState<ApiExchange[]>([]);
  const [inFlight, setInFlight] = useState(0);

  const track = useCallback(
    async (call: Promise<ApiExchange>): Promise<ApiExchange> => {
      setInFlight((n) => n + 1);
      try {
        const result = await call;
        setExchange(result);
        setHistory((prev) => [result, ...prev].slice(0, historySize));
        return result;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [historySize],
  );

  const reset = useCallback(() => {
    setExchange(null);
    setHistory([]);
  }, []);

  return { exchange, busy: inFlight > 0, history, track, reset };
}
