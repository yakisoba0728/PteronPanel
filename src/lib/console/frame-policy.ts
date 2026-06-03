export type AccessKind = 'owner' | 'admin' | 'subuser';
export interface Viewer { accessKind: AccessKind; permissions: string[]; }
export interface InboundFrame { event: string; args?: string[]; }

const STATE_PERMISSION: Record<string, string> = {
  start: 'control.start', stop: 'control.stop', restart: 'control.restart', kill: 'control.stop',
};

/** Whether a browser->Wings frame is permitted for this viewer. Owners/admins: all. */
export function isInboundAllowed(viewer: Viewer, frame: InboundFrame): boolean {
  if (viewer.accessKind !== 'subuser') return true;
  const held = new Set(viewer.permissions);
  switch (frame.event) {
    case 'auth':
    case 'send logs':
    case 'send stats':
      return true;
    case 'send command':
      return held.has('control.console');
    case 'set state': {
      const perm = STATE_PERMISSION[frame.args?.[0] ?? ''];
      return perm ? held.has(perm) : false;
    }
    default:
      return false;
  }
}
