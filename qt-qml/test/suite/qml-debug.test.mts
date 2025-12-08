// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { delay } from 'qt-lib';
import {
  setupSandboxLifecycleHooks,
  activateQtCore,
  activateQtQml,
  getWorkspaceFolderOrThrow,
  prepareCMakeQtEnvWithVersion,
  cleanBuildDir,
  cmakeConfigForWorkspace,
  waitForVSCodeIdle
} from '../helper.mts';
import {
  prepareQmlBreakpointsFromMarkers,
  addBreakpoints,
  makeQmlDebugConfig,
  startDebugAndWaitForStop,
  stopDebugSession,
  getLocals,
  getFlattenedLocals,
  type DebugVariable
} from '../debug-helper.mts';

const FS_SETTLE_DELAY_MS = 500;
const DISK_FLUSH_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Shared debug logging + sandbox lifecycle for this test file
// ---------------------------------------------------------------------------
const DEBUG = process.env.QT_TEST_DEBUG === '1';
const dlog = (...args: unknown[]) => {
  if (DEBUG) console.log(...args);
};

describe('QML Debugger integration', function () {
  this.timeout(150_000); // QML debugging can take longer
  let sb: sinon.SinonSandbox;

  setupSandboxLifecycleHooks(
    (_sb) => (sb = _sb),
    async () => {
      dlog('[qml-debug] Activating Qt extensions');
      await activateQtCore();
      await activateQtQml();
    }
  );

  it('configures, builds, and debugs Qt Quick app with QML debugging', async function () {
    const wsFolder = getWorkspaceFolderOrThrow();
    const cmakeConfigurator = cmakeConfigForWorkspace(wsFolder);
    await cmakeConfigurator.set('useCMakePresets', 'always');
    await waitForVSCodeIdle();

    const projectDir = wsFolder.uri.fsPath;
    const buildDir = await cleanBuildDir(projectDir, 'build-qml-debug');

    const qtRoot = vscode.workspace
      .getConfiguration('qt-core')
      .get<string>('qtInstallationRoot');
    if (typeof qtRoot !== 'string' || qtRoot.trim() === '') {
      throw new Error('qt-core.qtInstallationRoot is not configured.');
    }

    const qtEnv = prepareCMakeQtEnvWithVersion({
      topLevel: qtRoot,
      verbose: true
    });

    const presetsPath = path.join(projectDir, 'CMakePresets.json');

    // Create CMake Presets with QML debugging flags
    const presets = {
      version: 3,
      configurePresets: [
        {
          name: 'qml-debug',
          displayName: 'QML Debug Configuration',
          description: 'Debug build with QML debugging enabled',
          binaryDir: buildDir,
          cacheVariables: {
            CMAKE_BUILD_TYPE: 'Debug',
            CMAKE_PREFIX_PATH: qtEnv.leaf,
            // Enable QML debugging
            CMAKE_CXX_FLAGS_DEBUG_INIT: '-DQT_QML_DEBUG'
            // CMAKE_C_FLAGS_DEBUG_INIT: '-DQT_QML_DEBUG'
          }
        }
      ]
    };

    fs.writeFileSync(presetsPath, JSON.stringify(presets, null, 2), 'utf-8');
    console.log(
      '[qml-debug] Created CMakePresets.json with CMAKE_PREFIX_PATH:',
      qtEnv.leaf
    );
    console.log('[qml-debug] Using projectDir:', projectDir);

    // Wait for file system to settle
    await delay(FS_SETTLE_DELAY_MS);
    await waitForVSCodeIdle();

    // Disable automatic configuration
    await cmakeConfigurator.set('configureOnOpen', false);
    await cmakeConfigurator.set('automaticReconfigure', false);

    // Spy on error messages
    const errSpy = sb.spy(vscode.window, 'showErrorMessage');

    // Set the configure preset
    console.log('[qml-debug] Setting configure preset: qml-debug');
    await vscode.commands.executeCommand(
      'cmake.setConfigurePreset',
      'qml-debug'
    );
    await waitForVSCodeIdle();

    // Configure
    console.log('[qml-debug] Running cmake.configure...');
    const rcCfg =
      await vscode.commands.executeCommand<number>('cmake.configure');
    await waitForVSCodeIdle();
    expect(rcCfg, `cmake.configure failed (rc=${rcCfg})`).to.equal(0);

    // Build
    console.log('[qml-debug] Running cmake.build...');
    const rcBuild = await vscode.commands.executeCommand<number>('cmake.build');
    await waitForVSCodeIdle();
    expect(rcBuild, `cmake.build failed (rc=${rcBuild})`).to.equal(0);

    // Wait for build artifacts
    await delay(DISK_FLUSH_DELAY_MS);

    // Check for binary
    const bin =
      process.platform === 'win32'
        ? path.join('Debug', 'qml-debug-app.exe')
        : 'qml-debug-app';
    const outPath = path.join(buildDir, bin);
    console.log('[qml-debug] Checking for binary at', outPath);

    expect(fs.existsSync(outPath), `Expected build artifact at ${outPath}`).to
      .be.true;
    expect(errSpy.called, 'Unexpected error popups during build').to.be.false;

    // Now test QML debugging with the built application
    dlog('[qml-debug] Starting QML breakpoint and variable inspection');

    // Prepare breakpoints from markers in Main.qml
    const { doc, breakpoints } = await prepareQmlBreakpointsFromMarkers(
      projectDir,
      'Main.qml',
      'BREAK_HERE'
    );

    const removeBps = addBreakpoints(breakpoints);
    await waitForVSCodeIdle();

    try {
      // Verify breakpoint markers are present
      const lines = doc.getText().split('\n');
      const markerCount = lines.filter((ln) =>
        ln.includes('BREAK_HERE')
      ).length;
      expect(
        markerCount,
        'Expected BREAK_HERE markers in Main.qml'
      ).to.be.greaterThan(0);
      dlog(`[qml-debug] Found ${markerCount} breakpoint markers`);

      // Create QML debug configuration
      const debugConfig = await makeQmlDebugConfig();
      dlog('[qml-debug] Debug config created:', debugConfig.name);

      // Start debugging and wait for first stop
      const { session, stops } = await startDebugAndWaitForStop(
        wsFolder,
        debugConfig,
        { timeoutMs: 60000 }
      );

      try {
        expect(stops.length, 'Should stop at a breakpoint').to.be.greaterThan(
          0
        );
        dlog(`[qml-debug] Stopped at ${stops.length} location(s)`);

        const stop = stops[0]!;
        dlog('[qml-debug] First stop:', {
          source: stop.source,
          line: stop.line,
          frameId: stop.frameId
        });

        // Verify we stopped in Main.qml
        expect(stop.source, 'Should stop in Main.qml').to.include('Main.qml');

        // Get and inspect local variables
        const frameId = stop.frameId!;
        const locals = await getLocals(session, frameId);
        dlog(
          '[qml-debug] Locals found:',
          locals.map((v: any) => v.name).join(', ')
        );

        const flatLocals = await getFlattenedLocals(session, frameId);
        dlog('[qml-debug] Flattened locals count:', flatLocals.length);

        // Verify expected QML properties are present
        const counterVar = flatLocals.find(
          (v: DebugVariable) => v.name === 'counter'
        );
        const messageVar = flatLocals.find(
          (v: DebugVariable) => v.name === 'message'
        );
        const itemsVar = flatLocals.find(
          (v: DebugVariable) => v.name === 'items'
        );
        const isActiveVar = flatLocals.find(
          (v: DebugVariable) => v.name === 'isActive'
        );

        if (counterVar) {
          dlog('[qml-debug] counter:', counterVar.value);
          // After first breakpoint, counter should be 42
          expect(counterVar.value, 'counter should be 42').to.satisfy(
            (val: string) => val === '42' || val.includes('42')
          );
        } else {
          dlog('[qml-debug] Warning: counter variable not found in locals');
        }

        if (messageVar) {
          dlog('[qml-debug] message:', messageVar.value);
          expect(messageVar.value, 'message should contain text').to.be.a(
            'string'
          ).and.not.empty;
        } else {
          dlog('[qml-debug] Warning: message variable not found in locals');
        }

        if (itemsVar) {
          dlog('[qml-debug] items:', itemsVar.value);
        }

        if (isActiveVar) {
          dlog('[qml-debug] isActive:', isActiveVar.value);
          expect(isActiveVar.value, 'isActive should be true').to.satisfy(
            (val: string) => val === 'true' || val === '1'
          );
        }

        // Test passed - we successfully inspected QML variables
        dlog('[qml-debug] Successfully inspected QML variables!');
      } finally {
        await stopDebugSession(session);
        await delay(500);
      }
    } finally {
      removeBps();
    }
  });

  after('cleanup CMake configuration', async function () {
    // Cleanup after all tests
    const wsFolder = getWorkspaceFolderOrThrow();
    const projectDir = wsFolder.uri.fsPath;
    const presetsPath = path.join(projectDir, 'CMakePresets.json');
    const cmakeConfigurator = cmakeConfigForWorkspace(wsFolder);

    try {
      if (fs.existsSync(presetsPath)) {
        fs.unlinkSync(presetsPath);
      }
      await cmakeConfigurator.resetAll();
      await waitForVSCodeIdle();
    } catch (e) {
      console.warn('[qml-debug] Cleanup warning:', e);
    }
  });
});
