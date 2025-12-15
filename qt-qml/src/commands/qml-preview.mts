// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { telemetry } from 'qt-lib';
import { EXTENSION_ID } from '@/constants.js';
import { QmlPreviewConnectionManager } from '@preview/qml-preview-connection-manager.mjs';
import { FpsInfo } from '@preview/qml-preview-client.mjs';
import { Server, ServerScheme } from '@debug/debug-connection.mjs';

let previewManager: QmlPreviewConnectionManager | undefined;

export function registerStartQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.startQmlPreview`,
    async () => {
      telemetry.sendAction('startQmlPreview');

      if (previewManager?.isConnected()) {
        void vscode.window.showInformationMessage(
          'QML Preview is already running.'
        );
        return;
      }

      const port = await vscode.window.showInputBox({
        prompt: 'Enter the QML debug port (from your application launch)',
        placeHolder: '5555',
        validateInput: (value) => {
          const num = parseInt(value);
          if (isNaN(num) || num < 1 || num > 65535) {
            return 'Please enter a valid port number between 1 and 65535';
          }
          return undefined;
        }
      });

      if (!port) {
        return;
      }

      const server: Server = {
        host: 'localhost',
        port: parseInt(port),
        scheme: ServerScheme.Tcp
      };

      previewManager = new QmlPreviewConnectionManager();
      previewManager.setupFileWatcher();

      // Set up FPS handler (log only)
      previewManager.setFpsHandler((fps: FpsInfo) => {
        // Log FPS info to the extension output
        // eslint-disable-next-line no-console
        console.log(
          `QML Preview: ${fps.numSyncs} fps (${fps.minSync}ms-${fps.maxSync}ms)`
        );
      });

      try {
        previewManager.connectToServer(server);
        void vscode.window.showInformationMessage(
          `Connecting to QML Preview on port ${port}...`
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to start QML Preview: ${String(error)}`
        );
        previewManager.dispose();
        previewManager = undefined;
      }
    }
  );
}

export function registerStopQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.stopQmlPreview`,
    () => {
      telemetry.sendAction('stopQmlPreview');

      if (!previewManager) {
        void vscode.window.showInformationMessage(
          'QML Preview is not running.'
        );
        return;
      }

      previewManager.dispose();
      previewManager = undefined;
      void vscode.window.showInformationMessage('QML Preview stopped.');
    }
  );
}

export function registerReloadQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.reloadQmlPreview`,
    () => {
      telemetry.sendAction('reloadQmlPreview');

      if (!previewManager || !previewManager.isConnected()) {
        void vscode.window.showWarningMessage(
          'QML Preview is not connected. Please start it first.'
        );
        return;
      }

      previewManager.rerun();
      void vscode.window.showInformationMessage('QML Preview reloaded.');
    }
  );
}

export function registerSetQmlPreviewZoomCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.setQmlPreviewZoom`,
    async () => {
      telemetry.sendAction('setQmlPreviewZoom');

      if (!previewManager || !previewManager.isConnected()) {
        void vscode.window.showWarningMessage(
          'QML Preview is not connected. Please start it first.'
        );
        return;
      }

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
        return;
      }

      const zoom = parseFloat(zoomStr);
      previewManager.zoom(zoom);
      void vscode.window.showInformationMessage(
        `QML Preview zoom set to ${zoom}x`
      );
    }
  );
}

export function registerClearQmlPreviewCacheCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.clearQmlPreviewCache`,
    () => {
      telemetry.sendAction('clearQmlPreviewCache');

      if (!previewManager || !previewManager.isConnected()) {
        void vscode.window.showWarningMessage(
          'QML Preview is not connected. Please start it first.'
        );
        return;
      }

      previewManager.clearCache();
      void vscode.window.showInformationMessage('QML Preview cache cleared.');
    }
  );
}

export function disposePreviewManager() {
  if (previewManager) {
    previewManager.dispose();
    previewManager = undefined;
  }
}
