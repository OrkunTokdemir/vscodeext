// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  QtBridgeNewItemProvider,
  QtBridgeProjectPresetId,
  QtBridgeQmlPresetId
} from '@/new-item-provider.mjs';
import type { QtNewItemRequest } from 'qt-lib';

describe('Qt Bridge New Item provider', () => {
  let testDirectory: string;
  let calls: { args: readonly string[]; workingDirectory: string }[];

  beforeEach(async () => {
    testDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'qt-bridge-csharp-new-item-')
    );
    calls = [];
  });

  afterEach(async () => {
    await fs.promises.rm(testDirectory, { recursive: true, force: true });
  });

  function createProvider() {
    return new QtBridgeNewItemProvider((args, workingDirectory) => {
      calls.push({ args, workingDirectory });
      return Promise.resolve();
    });
  }

  function request(
    presetId: string,
    type: 'project' | 'file',
    name: string,
    options: Record<string, unknown> = {}
  ): QtNewItemRequest {
    return {
      type,
      name,
      workingDir: testDirectory,
      presetId,
      options
    };
  }

  it('creates projects through the dotnet template', async () => {
    const provider = createProvider();
    const result = await provider.create(
      request(QtBridgeProjectPresetId, 'project', 'Application', {
        Framework: 'net10.0',
        SampleCode: true
      })
    );

    expect(calls).to.deep.equal([
      {
        args: [
          'new',
          'qt',
          '--name',
          'Application',
          '--output',
          path.join(testDirectory, 'Application'),
          '--language',
          'C#',
          '--Framework',
          'net10.0',
          '--SampleCode'
        ],
        workingDirectory: testDirectory
      }
    ]);
    expect(result.generateProjectConfigs).to.equal(false);
    expect(result.filesDir).to.equal(path.join(testDirectory, 'Application'));
  });

  it('creates QML items without duplicating the extension', async () => {
    const provider = createProvider();
    const result = await provider.create(
      request(QtBridgeQmlPresetId, 'file', 'Details.qml')
    );

    expect(calls[0]?.args).to.deep.equal([
      'new',
      'qml',
      '--name',
      'Details',
      '--output',
      testDirectory,
      '--language',
      'C#'
    ]);
    expect(result.files).to.deep.equal(['Details.qml']);
  });

  it('rejects existing output paths', async () => {
    await fs.promises.mkdir(path.join(testDirectory, 'Application'));
    const issues = await createProvider().validate(
      request(QtBridgeProjectPresetId, 'project', 'Application')
    );

    expect(issues).to.deep.include({
      level: 'error',
      field: 'name',
      message: 'A file or directory with this name already exists'
    });
  });
});
