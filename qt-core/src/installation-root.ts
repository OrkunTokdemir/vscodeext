// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  Home,
  IsLinux,
  IsMacOS,
  IsWindows,
  QtInsRootConfigName,
  createLogger,
  QtWorkspaceConfigMessage
} from 'qt-lib';
import { EXTENSION_ID } from '@/constants';
import { coreAPI } from '@/extension';

const logger = createLogger('installation-root');

export async function setDoNotAskForDefaultQtInstallationRoot(value: boolean) {
  await vscode.workspace
    .getConfiguration(EXTENSION_ID)
    .update(
      'doNotAskForDefaultQtInstallationRoot',
      value,
      vscode.ConfigurationTarget.Global
    );
}

export function getCurrentGlobalQtInstallationRoot(): string {
  const qtInsRootConfig =
    getConfiguration().inspect<string>(QtInsRootConfigName);
  return qtInsRootConfig?.globalValue ?? '';
}

function getConfiguration() {
  return vscode.workspace.getConfiguration(EXTENSION_ID);
}

function getDoNotAskForDefaultQtInstallationRoot(): boolean {
  return (
    vscode.workspace
      .getConfiguration(EXTENSION_ID)
      .get<boolean>('doNotAskForDefaultQtInstallationRoot') ?? false
  );
}

export function checkDefaultQtInsRootPath() {
  if (getDoNotAskForDefaultQtInstallationRoot()) {
    return;
  }

  if (getCurrentGlobalQtInstallationRoot()) {
    // Qt installation root is already set. No need to check for default path
    return;
  }
  let defaultPath = '';
  if (IsLinux || IsMacOS) {
    defaultPath = path.join(Home, 'Qt');
  } else if (IsWindows) {
    const winRoot =
      process.env.WINDIR !== undefined
        ? path.parse(process.env.WINDIR).root
        : 'C:';
    defaultPath = path.join(winRoot, 'Qt');
  } else {
    const errorMessage = 'Unsupported OS';
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  const defaultPathExists = fs.existsSync(defaultPath);
  if (!defaultPathExists) {
    return;
  }

  const setDefaultPathButtonMessage = 'Set Qt Installation Root';
  const doNotShowAgainButtonMessage = 'Do not show again';
  void vscode.window
    .showInformationMessage(
      `Qt installation root was found at "${defaultPath}". Do you want to use it?`,
      setDefaultPathButtonMessage,
      doNotShowAgainButtonMessage
    )
    .then((response) => {
      if (response === setDefaultPathButtonMessage) {
        void setGlobalQtInstallationRoot(defaultPath);
      } else if (response === doNotShowAgainButtonMessage) {
        void setDoNotAskForDefaultQtInstallationRoot(true);
      }
    });
}

export async function registerQt() {
  const options: vscode.OpenDialogOptions = {
    canSelectMany: false,
    openLabel: 'Select Qt installation root',
    canSelectFiles: false,
    canSelectFolders: true
  };
  const selectedQtInsRootUri = await vscode.window.showOpenDialog(options);
  if (selectedQtInsRootUri?.[0] === undefined) {
    return;
  }
  const selectedQtInsRoot = selectedQtInsRootUri[0].fsPath;
  if (selectedQtInsRoot) {
    void setGlobalQtInstallationRoot(selectedQtInsRoot);
  }
  return 0;
}

async function setGlobalQtInstallationRoot(qtInsRoot: string) {
  logger.info(`Setting global Qt installation root to: ${qtInsRoot}`);
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);
  await config.update(
    QtInsRootConfigName,
    qtInsRoot,
    vscode.ConfigurationTarget.Global
  );
}

export function onQtInsRootUpdated(
  newQtInstallationRoot: string,
  folder: vscode.WorkspaceFolder | string
) {
  if (newQtInstallationRoot) {
    if (!fs.existsSync(newQtInstallationRoot)) {
      logger.warn(`The specified Qt installation path does not exist.`);
      void vscode.window.showWarningMessage(
        `The specified Qt installation path does not exist.`
      );
    }
  }
  logger.info(`Qt installation root updated: "${newQtInstallationRoot}"`);

  const message = new QtWorkspaceConfigMessage(folder);
  message.config.set(QtInsRootConfigName, newQtInstallationRoot);
  coreAPI?.update(message);
}
