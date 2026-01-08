// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

export interface AttachConnectionInfo {
  host: string;
  port: number;
}

/* eslint-disable @typescript-eslint/class-methods-use-this */
export class QmlPreviewUI {
  showError(message: string) {
    void vscode.window.showErrorMessage(message);
  }

  showInfo(message: string) {
    void vscode.window.showInformationMessage(message);
  }

  showWarning(message: string) {
    void vscode.window.showWarningMessage(message);
  }

  showAlreadyRunning() {
    this.showInfo('QML Preview is already running.');
  }

  showNotRunning() {
    this.showInfo('QML Preview is not running.');
  }

  showNotConnected() {
    this.showWarning('QML Preview is not connected. Please start it first.');
  }

  showFailedToGetPort() {
    this.showError('Failed to obtain a free port for QML Preview.');
  }

  showFailedToGetLaunchTarget() {
    this.showError('Failed to get launch target executable for QML Preview.');
  }

  showFailedToStartProcess() {
    this.showError('Failed to start QML Preview process.');
  }

  showProcessExited(code: number | null, signal: NodeJS.Signals | null) {
    this.showError(
      `QML Preview process exited with code ${code}, signal ${signal}`
    );
  }

  showFailedToStart(error: unknown) {
    this.showError(`Failed to start QML Preview: ${String(error)}`);
  }

  showFailedToAttach(error: unknown) {
    this.showError(`Failed to attach to QML Preview: ${String(error)}`);
  }

  showAttachSuccess(host: string, port: number) {
    this.showInfo(`Attached to QML Preview at ${host}:${port}`);
  }

  showStopped() {
    this.showInfo('QML Preview stopped.');
  }

  showReloaded() {
    this.showInfo('QML Preview reloaded.');
  }

  showZoomSet(zoom: number) {
    this.showInfo(`QML Preview zoom set to ${zoom}x`);
  }

  showCacheCleared() {
    this.showInfo('QML Preview cache cleared.');
  }

  setPreviewRunning() {
    void vscode.commands.executeCommand(
      'setContext',
      'qt-qml.qmlPreviewRunning',
      true
    );
  }

  setPreviewStopped() {
    void vscode.commands.executeCommand(
      'setContext',
      'qt-qml.qmlPreviewRunning',
      false
    );
  }

  async promptForHost(): Promise<string | undefined> {
    void this;
    return vscode.window.showInputBox({
      prompt: 'Enter the host address of the QML application',
      placeHolder: '127.0.0.1',
      value: '127.0.0.1'
    });
  }

  async promptForPort(): Promise<number | undefined> {
    void this;
    const portInput = await vscode.window.showInputBox({
      prompt: 'Enter the port number of the QML application',
      placeHolder: '12150',
      validateInput: (value) => {
        const num = parseInt(value);
        if (isNaN(num) || num <= 0 || num > 65535) {
          return 'Please enter a valid port number (1-65535)';
        }
        return undefined;
      }
    });

    if (!portInput) {
      return undefined;
    }

    return parseInt(portInput);
  }

  async promptForConnectionInfo(): Promise<AttachConnectionInfo | undefined> {
    const host = await this.promptForHost();
    if (!host) {
      return undefined;
    }

    const port = await this.promptForPort();
    if (!port) {
      return undefined;
    }

    return { host, port };
  }

  async promptForZoom(): Promise<number | undefined> {
    void this;
    const zoomStr = await vscode.window.showInputBox({
      prompt: 'Enter zoom factor (e.g., 1.0 for 100%, 2.0 for 200%)',
      placeHolder: '1.0',
      validateInput: (value) => {
        const num = parseFloat(value);
        if (isNaN(num) || num <= 0) {
          return 'Please enter a positive number';
        }
        return undefined;
      }
    });

    if (!zoomStr) {
      return undefined;
    }

    return parseFloat(zoomStr);
  }
}
