// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

export interface AttachConnectionInfo {
  host: string;
  port: number;
}
export interface FpsDisplayInfo {
  numSyncs: number;
  minSync: number;
  maxSync: number;
  minRender: number;
  maxRender: number;
}

/* eslint-disable @typescript-eslint/class-methods-use-this */
export class QmlPreviewUI {
  private readonly _fpsStatusItem: vscode.StatusBarItem;
  private _lastValidFps = 0;
  private _progressResolve: (() => void) | undefined;

  constructor() {
    this._fpsStatusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this._fpsStatusItem.name = 'QML Preview FPS';
  }

  updateFps(fps: FpsDisplayInfo) {
    const frames = fps.numSyncs;
    if (frames !== 0) {
      this._lastValidFps = frames;
    }

    let fpsText: string;
    if (this._lastValidFps === 0 || (frames === 0 && this._lastValidFps < 2)) {
      fpsText = '-- FPS';
    } else {
      fpsText = `${this._lastValidFps} FPS`;
    }

    this._fpsStatusItem.text = `$(pulse) ${fpsText}`;
    this._fpsStatusItem.tooltip = `QML Preview\nSync: ${fps.minSync}ms - ${fps.maxSync}ms\nRender: ${fps.minRender}ms - ${fps.maxRender}ms`;
  }

  showFpsStatus() {
    this._fpsStatusItem.text = '$(pulse) -- FPS';
    this._fpsStatusItem.tooltip = 'QML Preview FPS';
    this._fpsStatusItem.show();
  }

  hideFpsStatus() {
    this._lastValidFps = 0;
    this._fpsStatusItem.hide();
  }

  dispose() {
    this.removeWaitingForConnection();
    this._fpsStatusItem.dispose();
  }

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
    this.removeWaitingForConnection();
    this.showError(`Failed to attach to QML Preview: ${String(error)}`);
  }

  showAttachSuccess(host: string, port: number) {
    this.removeWaitingForConnection();
    // Remove notification after 5 seconds
    const title = `QML Preview attached successfully at ${host}:${port}`;
    const progressOptions = {
      title: title,
      location: vscode.ProgressLocation.Notification,
      cancellable: false
    };
    const timeout = 5000;
    void vscode.window.withProgress(progressOptions, async (progress) => {
      progress.report({ increment: 100 });
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, timeout);
      });
    });
  }

  showWaitingForConnection(host: string, port: number, onCancel?: () => void) {
    const title = `Connecting to QML Preview at ${host}:${port}...`;
    const progressOptions = {
      title: title,
      location: vscode.ProgressLocation.Notification,
      cancellable: true
    };

    return vscode.window.withProgress(
      progressOptions,
      async (progress, token) => {
        void progress;
        // Handle cancellation
        token.onCancellationRequested(() => {
          if (onCancel) {
            onCancel();
          }
          if (this._progressResolve) {
            this._progressResolve();
            this._progressResolve = undefined;
          }
        });

        return new Promise<void>((resolve) => {
          this._progressResolve = resolve;
        });
      }
    );
  }

  removeWaitingForConnection() {
    if (this._progressResolve) {
      this._progressResolve();
      this._progressResolve = undefined;
    }
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

  showConnectionClosed() {
    this.showInfo('QML Preview connection closed.');
  }

  setPreviewRunning() {
    void vscode.commands.executeCommand(
      'setContext',
      'qt-qml.qmlPreviewRunning',
      true
    );
    this.showFpsStatus();
  }

  setPreviewStopped() {
    void vscode.commands.executeCommand(
      'setContext',
      'qt-qml.qmlPreviewRunning',
      false
    );
    this.hideFpsStatus();
  }

  async promptForHost() {
    return vscode.window.showInputBox({
      prompt: 'Enter the host address of the QML application',
      placeHolder: '127.0.0.1',
      value: '127.0.0.1'
    });
  }

  async promptForPort() {
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

  async promptForZoom() {
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
