// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

export class QmlEngineUI {
  private progressResolve: (() => void) | undefined;
  showSuccesfullAttach() {
    if (this.progressResolve) {
      this.removeWaitingForDebugger();
    }
    void vscode.window.showInformationMessage(
      'QML Debugger attached successfully'
    );
  }
  showWaitingForDebugger() {
    void this;
    const progressOptions = {
      title: 'Waiting for debugger...',
      location: vscode.ProgressLocation.Notification,
      cancellable: false
    };

    return vscode.window.withProgress(progressOptions, async () => {
      return new Promise<void>((resolve) => {
        this.progressResolve = resolve;
      });
    });
  }

  removeWaitingForDebugger() {
    if (this.progressResolve) {
      this.progressResolve();
      this.progressResolve = undefined;
    }
  }
}
