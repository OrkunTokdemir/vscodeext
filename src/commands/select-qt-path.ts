// Copyright (C) 2023 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import * as qtregister from './register-qt-path';
import * as qtpath from '../util/get-qt-paths';

export async function selectQtPath() {
  const config = vscode.workspace.getConfiguration('vscode-qt-tools');
  let qtInstallations = config.get('qtInstallations') as readonly string[];

  if (qtInstallations.length === 0) {
    await qtregister.registerQt();
    qtInstallations = config.get('qtInstallations') as readonly string[];
  }

  if (qtInstallations.length !== 0) {
    // Show a quick pick dialog with the Qt installations as options
    const selected =
      qtInstallations.length === 1
        ? qtInstallations[0]
        : await vscode.window.showQuickPick(qtInstallations, {
            placeHolder: 'Select a default Qt installation'
          });
    if (selected) {
      const qtRootDir = qtpath.qtRootByQtInstallation(selected);
      await Promise.all([
        config.update(
          'selectedQtPath',
          selected,
          vscode.ConfigurationTarget.Workspace
        ),
        qtpath
          .locateNinjaExecutable(qtRootDir)
          .then((ninjaExePath) =>
            config.update(
              'cmake.configureSettings.CMAKE_MAKE_PROGRAM',
              ninjaExePath,
              vscode.ConfigurationTarget.Workspace
            )
          )
      ]);
    }
  }
}

function onQtInstallationsConfigUpdate(e: vscode.ConfigurationChangeEvent) {
  // When the configuration changes, execute the 'vscode-qt-tools.selectQtPath' command
  if (e.affectsConfiguration('vscode-qt-tools.qtInstallations')) {
    void vscode.commands.executeCommand('vscode-qt-tools.selectQtPath');
  }
}

export function registerPickSelectedQtPathCommand(
  context: vscode.ExtensionContext
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-qt-tools.selectQtPath',
      selectQtPath
    ),
    vscode.workspace.onDidChangeConfiguration(onQtInstallationsConfigUpdate)
  );
}
