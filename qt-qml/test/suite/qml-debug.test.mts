// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { expect } from 'chai';
import * as sinon from 'sinon';
// import * as vscode from 'vscode';

// import { delay } from 'qt-lib';
import {
  setupSandboxLifecycleHooks,
  // waitForVSCodeIdle,
  activateQtQml,
  activateQtCore
} from '../helper.mts';

// ---------------------------------------------------------------------------
// Shared debug logging + sandbox lifecycle for this test file
// ---------------------------------------------------------------------------
const DEBUG = process.env.QT_TEST_DEBUG === '1';
const dlog = (...args: unknown[]) => {
  if (DEBUG) console.log(...args);
};

let sb: sinon.SinonSandbox;

setupSandboxLifecycleHooks(
  // () => dlog('Creating sandbox'),
  (_sb) => (sb = _sb),
  async () => {
    void sb;
    dlog('Activating Qt extensions');
    await activateQtCore();
    await activateQtQml();
  }
);

describe('QML Debugger integration', function () {
  this.timeout(180_000); // QML debugging can take longer

  // TODO: Add QML debugging tests here
  // Each test should:
  // 1. Get workspace folder
  // 2. Configure CMake with QML debugging enabled
  // 3. Build the project
  // 4. Launch debugger
  // 5. Test debugging features (breakpoints, stepping, inspection, etc.)

  it('placeholder test - remove this when adding real tests', function () {
    expect(true).to.be.true;
  });
});
