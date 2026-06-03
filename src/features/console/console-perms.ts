import type { AccessKind } from '@/lib/authz/visible-tabs';

export interface ConsoleControls {
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  canKill: boolean;
  canCommand: boolean;
}

/**
 * Decide which console controls a viewer may use.
 *
 * Owners and admins get every control. Subusers are gated per Wings
 * permissions: kill maps to `control.stop` (same as Wings), and the command
 * input maps to `control.console`.
 *
 * NOTE: The console WS proxy now enforces these permissions server-side on
 * every inbound Wings frame (the browser never receives the Wings token), so
 * this UI gating is defense-in-depth on top of that enforcement rather than
 * the sole mitigation.
 */
export function consoleControls(
  accessKind: AccessKind,
  permissions: string[],
): ConsoleControls {
  if (accessKind !== 'subuser') {
    return {
      canStart: true,
      canStop: true,
      canRestart: true,
      canKill: true,
      canCommand: true,
    };
  }

  const held = new Set(permissions);
  return {
    canStart: held.has('control.start'),
    canStop: held.has('control.stop'),
    canRestart: held.has('control.restart'),
    canKill: held.has('control.stop'),
    canCommand: held.has('control.console'),
  };
}
