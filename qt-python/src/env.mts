// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as path from 'path';
import { Environment } from '@vscode/python-extension';

import * as utils from './utils.js';
import * as consts from './constants.mjs';

export class PySideEnv {
  private readonly _pyEnv: Environment | undefined;

  constructor(pyenv?: Environment) {
    this._pyEnv = pyenv;
  }

  get venvBinPath(): string {
    const root = this._pyEnv?.executable.sysPrefix ?? '';
    return root
      ? utils.normalizePath(path.join(root, consts.VENV.BIN_DIR))
      : '';
  }
}
