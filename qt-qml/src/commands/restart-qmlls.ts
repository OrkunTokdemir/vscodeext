// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { telemetry } from 'qt-lib';
import { qmlls } from '@/extension';
import { EXTENSION_ID } from '@/constants';

export function registerRestartQmllsCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.restartQmlls`,
    async () => {
      telemetry.sendAction('restartQmlls');
      await qmlls.restart();
    }
  );
}
