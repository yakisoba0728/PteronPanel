'use client';

import { useEffect, useRef, useState } from 'react';
import { getPluginContextAction } from '@/server/plugins';

export function PluginFrame({ pluginId, src }: { pluginId: string; src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = (() => {
    try {
      return new URL(src).origin;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (!origin) {
      setError('잘못된 플러그인 URL');
      return;
    }

    let cancelled = false;
    async function onLoad() {
      const result = await getPluginContextAction(pluginId);
      if (cancelled) return;
      if (!result.ok) {
        setError('컨텍스트 토큰 발급 실패');
        return;
      }

      ref.current?.contentWindow?.postMessage(
        { type: 'pteron:context', token: result.token, apiBase: location.origin },
        origin!,
      );
    }

    const iframe = ref.current;
    iframe?.addEventListener('load', onLoad);
    return () => {
      cancelled = true;
      iframe?.removeEventListener('load', onLoad);
    };
  }, [pluginId, origin]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <iframe
      ref={ref}
      src={src}
      sandbox="allow-scripts allow-forms"
      className="h-[70vh] w-full rounded-md border border-zinc-200 dark:border-zinc-800"
      title="plugin"
    />
  );
}
