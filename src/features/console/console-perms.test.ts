import { describe, expect, it } from 'vitest';
import { consoleControls } from './console-perms';

describe('consoleControls', () => {
  it('grants every control to owners', () => {
    expect(consoleControls('owner', [])).toEqual({
      canStart: true,
      canStop: true,
      canRestart: true,
      canKill: true,
      canCommand: true,
    });
  });

  it('grants every control to admins', () => {
    expect(consoleControls('admin', [])).toEqual({
      canStart: true,
      canStop: true,
      canRestart: true,
      canKill: true,
      canCommand: true,
    });
  });

  it('gives a subuser with only control.console just the command input', () => {
    expect(consoleControls('subuser', ['control.console'])).toEqual({
      canStart: false,
      canStop: false,
      canRestart: false,
      canKill: false,
      canCommand: true,
    });
  });

  it('maps kill to control.stop for subusers', () => {
    expect(consoleControls('subuser', ['control.stop'])).toEqual({
      canStart: false,
      canStop: true,
      canRestart: false,
      canKill: true,
      canCommand: false,
    });
  });

  it('grants nothing to a subuser with no control permissions', () => {
    expect(consoleControls('subuser', ['file.read'])).toEqual({
      canStart: false,
      canStop: false,
      canRestart: false,
      canKill: false,
      canCommand: false,
    });
  });

  it('grants the full control set to a subuser holding all control permissions', () => {
    expect(
      consoleControls('subuser', [
        'control.start',
        'control.stop',
        'control.restart',
        'control.console',
      ]),
    ).toEqual({
      canStart: true,
      canStop: true,
      canRestart: true,
      canKill: true,
      canCommand: true,
    });
  });
});
