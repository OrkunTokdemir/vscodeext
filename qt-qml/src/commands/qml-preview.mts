// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { ChildProcess } from 'child_process';

import { createLogger, telemetry } from 'qt-lib';
import { EXTENSION_ID } from '@/constants.js';
import { QmlPreviewConnectionManager } from '@preview/qml-preview-connection-manager.mjs';
import { FpsInfo } from '@preview/qml-preview-client.mjs';
import { Server, ServerScheme } from '@debug/debug-connection.mjs';
import getPort from 'get-port';
import { spawnProcessForTool } from '@/utils.ts';

let previewManager: QmlPreviewConnectionManager | undefined;
let previewProcess: ChildProcess | undefined;

const logger = createLogger('qml-preview');

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
      const dispose = () => {
        if (previewManager) {
          previewManager.dispose();
          previewManager = undefined;
        }
      };

      // Obtain port a free port
      const port = await getPort();

      if (!port) {
        void vscode.window.showErrorMessage(
          'Failed to obtain a free port for QML Preview.'
        );
        return;
      }
      const host = '127.0.0.1';
      const server: Server = {
        host: host,
        port: parseInt(port.toString()),
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
      // -qmljsdebugger=host:127.0.0.1,port:12150,block,services:QmlPreview,DebugTranslation
      const ret = await vscode.commands.executeCommand(
        'cmake.getLaunchTargetPath'
      );
      const program = ret as string;
      if (!program) {
        void vscode.window.showErrorMessage(
          'Failed to get launch target executable for QML Preview.'
        );
        dispose();
        return;
      }
      const previewArgs = `-qmljsdebugger=host:${server.host},port:${server.port},block,services:QmlPreview,DebugTranslation`;
      const command = `${program} ${previewArgs}`;
      logger.info('Starting QML Preview with command:', command);
      previewProcess = await spawnProcessForTool(command, []);
      // Check if the process started successfully
      if (previewProcess.killed || previewProcess.pid === undefined) {
        void vscode.window.showErrorMessage(
          'Failed to start QML Preview process.'
        );
        dispose();
        return;
      }
      logger.info(
        `QML Preview process started with PID: ${previewProcess.pid}`
      );
      previewProcess.on('exit', (code, signal) => {
        void vscode.window.showErrorMessage(
          `QML Preview process exited with code ${code}, signal ${signal}`
        );
        dispose();
        previewProcess = undefined;
      });
      try {
        // Get executable by using cmake.getLaunchTargetFilename
        previewManager.connectToServer(server);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to start QML Preview: ${String(error)}`
        );
        dispose();
        previewProcess.kill();
        previewProcess = undefined;
        return;
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
