// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import getPort from 'get-port';

import { EXTENSION_ID } from '@/constants';

let prevPort = '';
let count = 0;

export function registerDebugPort() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.debugPort`,
    async () => {
      count++;
      let temp = 0;
      if (prevPort) {
        temp = await getPort({ port: parseInt(prevPort) });
      } else {
        temp = await getPort();
      }
      const port = temp.toString();
      if (count === 2 && port !== prevPort) {
        count = 0;
        prevPort = '';
        return prevPort;
      }
      prevPort = port;
      return port;
    }
  );
}
