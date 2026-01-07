// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { spawn, SpawnOptions } from 'child_process';

import { createLogger, IsWindows, IsLinux } from 'qt-lib';

const logger = createLogger('utils');

export async function spawnProcessForTool(
  command: string,
  additionalArgs: string[] = []
) {
  const quoteArg = (arg: string): string => {
    // Escape double quotes and wrap the argument in quotes
    const escaped = arg.replace(/(["\\])/g, '\\$1');
    return `"${escaped}"`;
  };
  if (additionalArgs.length > 0) {
    command += ` ${additionalArgs.map(quoteArg).join(' ')}`;
  }
  logger.info('Starting program:', command);
  let options: SpawnOptions = {
    shell: true
  };
  if (IsLinux) {
    options = {
      ...options,
      detached: true
    };
  }
  if (IsWindows) {
    const dllDirs = await vscode.commands.executeCommand(`qt-cpp.qtDir`);
    if (dllDirs !== undefined) {
      const env = { ...process.env };
      env.PATH = `${dllDirs as string};${env.PATH}`;
      options = {
        ...options,
        env: env
      };
    }
  }
  return spawn(command, options);
}
