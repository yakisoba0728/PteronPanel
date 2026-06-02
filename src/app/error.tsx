'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">문제가 발생했습니다</h1>
      <p className="text-sm text-zinc-500">
        일시적인 오류일 수 있습니다. 다시 시도해 주세요.
        {error.digest ? ` (${error.digest})` : ''}
      </p>
      <button onClick={reset} className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white">
        다시 시도
      </button>
    </main>
  );
}
