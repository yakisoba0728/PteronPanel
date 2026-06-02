'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { loginAction, type LoginState } from '@/server/auth';

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-semibold">Pteron Panel 로그인</h1>
        <form action={action} className="space-y-3">
          <Input
            name="identifier"
            placeholder="아이디 또는 이메일"
            autoComplete="username"
          />
          <Input
            name="password"
            type="password"
            placeholder="비밀번호"
            autoComplete="current-password"
          />
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? '로그인 중…' : '로그인'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
