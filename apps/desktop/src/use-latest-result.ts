import { useEffect, useRef, useState } from 'react';
import { latestRequest } from './editor-state.mjs';

export function useLatestResult<T = any>() {
  const request = useRef<ReturnType<typeof latestRequest> | null>(null);
  request.current ??= latestRequest();
  const [data, setData] = useState<T>();
  useEffect(() => () => request.current!.invalidate(), []);
  return {
    data,
    clear: () => { request.current!.invalidate(); setData(undefined); },
    load: (read: () => Promise<T>) => {
      setData(undefined);
      return request.current!.run(read, setData);
    },
  };
}
