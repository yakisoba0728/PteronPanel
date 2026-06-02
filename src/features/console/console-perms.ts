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
 * NOTE: This is a UI mitigation only. A subuser lacking a permission could
 * still drive Wings via the websocket token, so true server-side enforcement
 * (a console WS proxy) is tracked separately.
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
