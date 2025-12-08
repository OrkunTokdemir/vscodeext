// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Open a QML file from a project dir and create breakpoints on the FIRST
 * executable-looking line AFTER every `// BREAK_HERE` marker.
 *
 * Returns the opened document and the prepared SourceBreakpoints (not yet added).
 */
export async function prepareQmlBreakpointsFromMarkers(
  projectDir: string,
  relQmlPath: string,
  marker = 'BREAK_HERE'
): Promise<{
  doc: vscode.TextDocument;
  breakpoints: vscode.SourceBreakpoint[];
}> {
  const qmlPath = path.join(projectDir, relQmlPath);
  const doc = await vscode.workspace.openTextDocument(qmlPath);
  await vscode.window.showTextDocument(doc);

  const lines = doc.getText().split('\n');
  const markerIdxs = lines
    .map((ln, i) => (ln.includes(marker) ? i : -1))
    .filter((i) => i >= 0);

  if (markerIdxs.length === 0) {
    throw new Error(`No // ${marker} markers found in ${relQmlPath}`);
  }

  const isSkippable = (s: string) => {
    const t = s.trim();
    return t.length === 0 || t.startsWith('//');
  };

  const locations: vscode.Location[] = [];
  for (const idx of markerIdxs) {
    let target = Math.min(idx + 1, lines.length - 1);
    while (target < lines.length && isSkippable(lines[target]!)) {
      target++;
    }
    if (target >= lines.length) target = lines.length - 1;
    locations.push(
      new vscode.Location(doc.uri, new vscode.Position(target, 0))
    );
  }

  const breakpoints = locations.map(
    (loc) => new vscode.SourceBreakpoint(loc, true)
  );
  return { doc, breakpoints };
}

/** Add breakpoints; returns a disposer to remove them later. */
export function addBreakpoints(bps: vscode.SourceBreakpoint[]) {
  vscode.debug.addBreakpoints(bps);
  return () => vscode.debug.removeBreakpoints(bps);
}

/**
 * Build a QML debug configuration for Qt Quick application
 */
export async function makeQmlDebugConfig(): Promise<vscode.DebugConfiguration> {
  // Resolve what ${command:...} would have produced
  const program = await vscode.commands.executeCommand<string>(
    'cmake.launchTargetPath'
  );
  const cwd = await vscode.commands.executeCommand<string>(
    'cmake.getLaunchTargetDirectory'
  );

  if (!program || !cwd) {
    throw new Error(
      `Failed to resolve debug launch paths from CMake Tools.
     program=${program ?? '<undefined>'}, cwd=${cwd ?? '<undefined>'}`
    );
  }

  const cfg: vscode.DebugConfiguration = {
    name: 'qml-debug-test-launch',
    type: 'qml',
    request: 'launch',
    program: program,
    cwd: cwd,
    stopAtEntry: false
  };

  if (process.env.QT_TEST_DEBUG === '1') {
    console.log('[qml-debug] Debug config:', cfg);
  }

  return cfg;
}

/**
 * Start debugging and wait for first 'stopped' event
 */
export async function startDebugAndWaitForStop(
  wsFolder: vscode.WorkspaceFolder,
  cfg: vscode.DebugConfiguration,
  opts?: { timeoutMs?: number }
): Promise<{
  session: vscode.DebugSession;
  stops: Array<{
    source?: string;
    line?: number;
    threadId?: number;
    frameId?: number;
  }>;
}> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  let session!: vscode.DebugSession;
  const stops: Array<{
    source?: string;
    line?: number;
    threadId?: number;
    frameId?: number;
  }> = [];

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for 'stopped'`)),
      timeoutMs
    );

    const trackerDisp = vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker: (s) => {
        session = s;
        return {
          onDidSendMessage: async (m: any) => {
            if (m?.event === 'stopped') {
              const reason: string | undefined = m?.body?.reason;
              let tid: number | undefined = m?.body?.threadId;

              try {
                if (tid == null) {
                  const threads = await s.customRequest('threads');
                  tid = threads?.threads?.[0]?.id;
                  if (tid == null) throw new Error('No debug thread found');
                }

                // For QML debugging, we want to capture breakpoint stops
                if (reason === 'breakpoint' || reason === 'step') {
                  const st = await s.customRequest('stackTrace', {
                    threadId: tid
                  });
                  const f = st?.stackFrames?.[0];
                  stops.push({
                    source: f?.source?.path,
                    line: f?.line,
                    threadId: tid,
                    frameId: f?.id
                  });

                  clearTimeout(timer);
                  trackerDisp.dispose();
                  resolve();
                }
              } catch (err) {
                clearTimeout(timer);
                trackerDisp.dispose();
                reject(err);
              }
            }
          }
        };
      }
    });

    vscode.debug.startDebugging(wsFolder, cfg).then(
      (started) => {
        if (!started) {
          clearTimeout(timer);
          trackerDisp.dispose();
          reject(new Error('Failed to start debugging'));
        }
      },
      (err) => {
        clearTimeout(timer);
        trackerDisp.dispose();
        reject(err);
      }
    );
  });

  await done;
  return { session, stops };
}

/**
 * Stop the debug session
 */
export async function stopDebugSession(
  session: vscode.DebugSession
): Promise<void> {
  if (session && vscode.debug.activeDebugSession === session) {
    await vscode.commands.executeCommand('workbench.action.debug.stop');
  }
}

/**
 * Get the top frame ID from the debug session
 */
export async function getTopFrameId(
  session: vscode.DebugSession
): Promise<number> {
  const { threads } = await session.customRequest('threads');
  const threadId = threads?.[0]?.id;
  if (threadId == null) throw new Error('No debug thread found');
  const { stackFrames } = await session.customRequest('stackTrace', {
    threadId
  });
  const frame = stackFrames?.[0];
  if (!frame) throw new Error('No stack frame');
  return frame.id as number;
}

/**
 * Get local variables from a debug frame
 */
export async function getLocals(session: vscode.DebugSession, frameId: number) {
  const { scopes } = await session.customRequest('scopes', { frameId });
  const localsScope =
    scopes?.find((sc: any) => /locals?/i.test(sc.name)) ?? scopes?.[0];
  if (!localsScope) throw new Error('No Locals scope found');
  const { variables } = await session.customRequest('variables', {
    variablesReference: localsScope.variablesReference
  });
  return variables ?? [];
}

export interface DebugVariable {
  name: string;
  type?: string;
  value?: string;
  variablesReference?: number;
}

/**
 * Get flattened local variables with dotted names (e.g., "obj.property")
 */
export async function getFlattenedLocals(
  session: vscode.DebugSession | undefined,
  frameId: number,
  maxDepth = 3
): Promise<DebugVariable[]> {
  if (!session) {
    throw new Error('[qml-debug] No active debug session');
  }

  const roots = await getLocals(session, frameId);
  const acc: DebugVariable[] = [];

  async function walkVar(v: any, prefix: string, depth: number): Promise<void> {
    // Skip debugger synthetic nodes
    if (v.name === '[Raw View]') {
      return;
    }
    const fullName = prefix ? `${prefix}.${v.name}` : v.name;

    acc.push({
      name: fullName,
      type: v.type,
      value: typeof v.value === 'string' ? v.value : String(v.value ?? ''),
      variablesReference: v.variablesReference
    });

    if (
      !v.variablesReference ||
      v.variablesReference <= 0 ||
      depth >= maxDepth
    ) {
      return;
    }

    const varsResponse = (await session!.customRequest('variables', {
      variablesReference: v.variablesReference
    })) as { variables: any[] };

    for (const child of varsResponse.variables) {
      await walkVar(child, fullName, depth + 1);
    }
  }

  for (const root of roots) {
    await walkVar(root, '', 0);
  }

  return acc;
}
