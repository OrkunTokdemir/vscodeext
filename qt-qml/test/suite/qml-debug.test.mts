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
  evaluateExpression
} from '../debug-helper.mts';

const FS_SETTLE_DELAY_MS = 500;
const DISK_FLUSH_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// QML Debugger Integration Tests
// ---------------------------------------------------------------------------
// This test suite validates QML debugging functionality including:
// 1. Breakpoint hits and stack traces
// 2. Variable evaluation via DAP evaluate request
// 3. Execution control (continue, step, etc.)
//
// Important notes about QML debugging:
// - QML object properties (counter, message, etc.) are NOT JavaScript local variables
// - They do NOT appear in DAP scopes (Global, Local, Closure scopes)
// - QML properties MUST be accessed via DAP 'evaluate' request
// - JavaScript local variables in QML functions DO appear in scopes
//
// Run with: QT_TEST_DEBUG=1 npm run test:qt-qml -- --qt-root="/path/to/Qt"
// ---------------------------------------------------------------------------

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
            CMAKE_PREFIX_PATH: qtEnv.leaf
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
        expect(stop.line, 'Should have line number').to.be.greaterThan(0);

        dlog('[qml-debug] Successfully hit QML breakpoint at line', stop.line);

        // Test basic debugging functionality is working
        expect(session, 'Debug session should be active').to.exist;
        expect(stop.threadId, 'Should have thread ID').to.exist;
        expect(stop.frameId, 'Should have frame ID').to.exist;
      } finally {
        await stopDebugSession(session);
        await delay(500);
      }
    } finally {
      removeBps();
    }
  });

  it('can evaluate QML variable expressions', async function () {
    const wsFolder = getWorkspaceFolderOrThrow();
    const projectDir = wsFolder.uri.fsPath;

    // Prepare breakpoints - we want to stop after counter and message are set
    const { breakpoints } = await prepareQmlBreakpointsFromMarkers(
      projectDir,
      'Main.qml',
      'BREAK_HERE'
    );

    const removeBps = addBreakpoints(breakpoints);
    await waitForVSCodeIdle();

    try {
      const debugConfig = await makeQmlDebugConfig();

      // Start debugging and wait for first stop
      const { session, stops } = await startDebugAndWaitForStop(
        wsFolder,
        debugConfig,
        { timeoutMs: 60000 }
      );

      try {
        const stop = stops[0]!;
        const frameId = stop.frameId;

        dlog('[qml-debug] Testing variable evaluation at breakpoint');

        // Try to evaluate QML property expressions
        // Evaluate counter variable
        const counterResult = await evaluateExpression(
          session,
          'counter',
          frameId
        );
        dlog('[qml-debug] counter =', counterResult.result);

        // After the first breakpoint, counter should be 42
        if (counterResult.result !== undefined) {
          expect(
            counterResult.result,
            'counter should be 42 after assignment'
          ).to.satisfy((val: string) => val === '42' || val.includes('42'));
        }

        // Evaluate message variable
        const messageResult = await evaluateExpression(
          session,
          'message',
          frameId
        );
        dlog('[qml-debug] message =', messageResult.result);

        if (messageResult.result !== undefined) {
          expect(
            messageResult.result,
            'message should contain "Debug test running"'
          ).to.include('Debug test running');
        }

        // Evaluate items array
        const itemsResult = await evaluateExpression(session, 'items', frameId);
        dlog('[qml-debug] items =', itemsResult.result);

        // Evaluate isActive boolean
        const isActiveResult = await evaluateExpression(
          session,
          'isActive',
          frameId
        );
        dlog('[qml-debug] isActive =', isActiveResult.result);

        if (isActiveResult.result !== undefined) {
          expect(isActiveResult.result, 'isActive should be true').to.satisfy(
            (val: string) => val === 'true' || val.includes('true')
          );
        }

        // Try evaluating an expression
        const exprResult = await evaluateExpression(
          session,
          'counter + 1',
          frameId
        );
        dlog('[qml-debug] counter + 1 =', exprResult.result);

        if (exprResult.result !== undefined) {
          expect(exprResult.result, 'counter + 1 should be 43').to.satisfy(
            (val: string) => val === '43' || val.includes('43')
          );
        }

        dlog('[qml-debug] Successfully evaluated QML variables!');
      } finally {
        await stopDebugSession(session);
        await delay(500);
      }
    } finally {
      removeBps();
    }
  });

  it('can retrieve stack trace information', async function () {
    const wsFolder = getWorkspaceFolderOrThrow();
    const projectDir = wsFolder.uri.fsPath;

    const { breakpoints } = await prepareQmlBreakpointsFromMarkers(
      projectDir,
      'Main.qml',
      'BREAK_HERE'
    );

    const removeBps = addBreakpoints(breakpoints);
    await waitForVSCodeIdle();

    try {
      const debugConfig = await makeQmlDebugConfig();
      const { session, stops } = await startDebugAndWaitForStop(
        wsFolder,
        debugConfig,
        { timeoutMs: 60000 }
      );

      try {
        const stop = stops[0]!;

        // Get full stack trace
        const threadId = stop.threadId ?? 1;
        const stackTrace = await session.customRequest('stackTrace', {
          threadId
        });

        dlog('[qml-debug] Stack trace:', JSON.stringify(stackTrace, null, 2));

        expect(stackTrace, 'Should have stack trace').to.exist;
        expect(stackTrace.stackFrames, 'Should have stack frames').to.be.an(
          'array'
        );
        expect(
          stackTrace.stackFrames.length,
          'Should have at least one frame'
        ).to.be.greaterThan(0);

        const topFrame = stackTrace.stackFrames[0];
        expect(topFrame.source, 'Frame should have source').to.exist;
        expect(
          topFrame.source.path,
          'Frame source should have path'
        ).to.include('Main.qml');
        expect(
          topFrame.line,
          'Frame should have line number'
        ).to.be.greaterThan(0);
        expect(topFrame.name, 'Frame should have name').to.be.a('string').and
          .not.empty;

        dlog('[qml-debug] Stack frame validated:', {
          source: topFrame.source.path,
          line: topFrame.line,
          name: topFrame.name
        });
      } finally {
        await stopDebugSession(session);
        await delay(500);
      }
    } finally {
      removeBps();
    }
  });

  it('can continue execution after breakpoint', async function () {
    const wsFolder = getWorkspaceFolderOrThrow();
    const projectDir = wsFolder.uri.fsPath;

    const { breakpoints } = await prepareQmlBreakpointsFromMarkers(
      projectDir,
      'Main.qml',
      'BREAK_HERE'
    );

    const removeBps = addBreakpoints(breakpoints);
    await waitForVSCodeIdle();

    try {
      const debugConfig = await makeQmlDebugConfig();
      const { session, stops } = await startDebugAndWaitForStop(
        wsFolder,
        debugConfig,
        { timeoutMs: 60000 }
      );

      try {
        const stop = stops[0]!;
        expect(stop.threadId, 'Should have thread ID').to.exist;

        // Try to continue execution
        await session.customRequest('continue', {
          threadId: stop.threadId
        });

        dlog('[qml-debug] Successfully continued execution');

        // Give it a moment to continue
        await delay(500);

        // Session should still be active
        expect(
          vscode.debug.activeDebugSession,
          'Debug session should still be active'
        ).to.exist;
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
