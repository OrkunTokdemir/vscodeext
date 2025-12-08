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

  it('configures and builds Qt Quick app with QML debugging enabled', async function () {
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

    // Cleanup
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
