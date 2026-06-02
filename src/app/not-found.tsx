import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-bold">404</h1>
      <p className="text-sm text-zinc-500">요청한 페이지나 서버를 찾을 수 없습니다.</p>
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        홈으로
      </Link>
    </main>
  );
}
