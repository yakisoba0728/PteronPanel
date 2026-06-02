'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { StartupVariable } from '@/lib/ptero/types';
import {
  getStartupAction,
  updateStartupVariableAction,
} from '@/server/startup';

export function StartupView({ identifier }: { identifier: string }) {
  const [variables, setVariables] = useState<StartupVariable[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await getStartupAction(identifier);
    if (res.ok) {
      setVariables(res.variables);
      setValues(
        Object.fromEntries(
          res.variables.map((variable) => [
            variable.env_variable,
            variable.server_value,
          ]),
        ),
      );
    } else {
      setMessage(
        res.error === 'not_found'
          ? '서버를 찾을 수 없습니다.'
          : (res.detail ?? '실패'),
      );
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier]);

  async function save(variable: StartupVariable) {
    const res = await updateStartupVariableAction(
      identifier,
      variable.env_variable,
      values[variable.env_variable] ?? '',
    );
    setMessage(res.ok ? '저장됨' : (res.detail ?? '저장 실패'));
  }

  return (
    <div className="space-y-3">
      <h2 className="font-medium">Startup 변수</h2>

      {message && <p className="text-sm text-zinc-500">{message}</p>}

      {variables.map((variable) => (
        <Card key={variable.env_variable} className="flex items-end gap-2">
          <label className="flex-1 text-sm">
            <span className="text-zinc-500">
              {variable.name} ({variable.env_variable})
            </span>
            <Input
              value={values[variable.env_variable] ?? ''}
              disabled={!variable.is_editable}
              onChange={(event) =>
                setValues({
                  ...values,
                  [variable.env_variable]: event.target.value,
                })
              }
            />
          </label>
          {variable.is_editable && (
            <Button type="button" onClick={() => save(variable)}>
              저장
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}
