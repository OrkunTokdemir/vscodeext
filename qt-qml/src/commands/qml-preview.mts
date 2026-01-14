// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { createLogger, delay, telemetry } from 'qt-lib';
import { EXTENSION_ID } from '@/constants.js';
import { QmlPreviewConnectionManager } from '@preview/qml-preview-connection-manager.mjs';
import { FpsInfo } from '@preview/qml-preview-client.mjs';
import { Server, ServerScheme } from '@debug/debug-connection.mjs';
import { QmlPreviewUI } from '@preview/ui.js';
import getPort from 'get-port';
import { QtProcess, spawnProcessForTool } from '@/utils.mts';

let previewManager: QmlPreviewConnectionManager | undefined;
let previewProcess: QtProcess | undefined;

const logger = createLogger('qml-preview');
const ui = new QmlPreviewUI();

async function startQmlPreviewImpl(options: {
  loadCurrentFile: boolean;
  action: string;
}) {
  telemetry.sendAction(options.action);

  if (previewManager?.isConnected()) {
    ui.showAlreadyRunning();
    return;
  }

  let currentQmlFile: string | undefined;

  // Get current QML file if requested
  if (options.loadCurrentFile) {
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor &&
      (activeEditor.document.languageId === 'qml' ||
        activeEditor.document.fileName.endsWith('.qml'))
    ) {
      currentQmlFile = activeEditor.document.uri.fsPath;
      logger.info('Current QML file:', currentQmlFile);
    } else {
      void vscode.window.showWarningMessage(
        'No QML file is currently open. Please open a QML file to preview.'
      );
      return;
    }
  }

  const dispose = () => {
    if (previewManager) {
      previewManager.dispose();
      previewManager = undefined;
    }
    ui.setPreviewStopped();
  };

  // Obtain a free port
  const port = await getPort();

  if (!port) {
    ui.showFailedToGetPort();
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

  // Handle connection closed (when app exits)
  previewManager.onConnectionClosed(() => {
    logger.info('QML Preview connection closed');
    ui.showConnectionClosed();
    dispose();
    if (previewProcess) {
      previewProcess.kill();
      previewProcess = undefined;
    }
  });

  // Set up FPS handler (log only)
  previewManager.setFpsHandler((fps: FpsInfo) => {
    // Log FPS info to the extension output
    // eslint-disable-next-line no-console
    console.log(
      `QML Preview: ${fps.numSyncs} fps (${fps.minSync}ms-${fps.maxSync}ms)`
    );
  });

  // -qmljsdebugger=host:127.0.0.1,port:12150,block,services:QmlPreview,DebugTranslation
  const ret = await vscode.commands.executeCommand('cmake.launchTargetPath');
  const program = ret as string;
  if (!program) {
    ui.showFailedToGetLaunchTarget();
    dispose();
    return;
  }

  const previewArgs = `-qmljsdebugger=host:${server.host},port:${server.port},block,services:QmlPreview,DebugTranslation`;
  // Add current QML file as argument if requested
  const command = currentQmlFile
    ? `${program} "${currentQmlFile}" ${previewArgs}`
    : `${program} ${previewArgs}`;
  logger.info('Starting QML Preview with command:', command);

  previewProcess = await spawnProcessForTool(command, []);
  // Check if the process started successfully
  if (previewProcess.killed || previewProcess.pid === undefined) {
    ui.showFailedToStartProcess();
    dispose();
    return;
  }
  logger.info(`QML Preview process started with PID: ${previewProcess.pid}`);

  previewProcess.on('exit', (code, signal) => {
    const isKilledbyUser =
      (signal === 'SIGTERM' && code === null) || code === 0;
    if (!isKilledbyUser) {
      ui.showProcessExited(code, signal);
    }
    if (previewManager) {
      previewManager.dispose();
      previewManager = undefined;
    }
    dispose();
    previewProcess = undefined;
  });

  try {
    previewManager.connectToServer(server);
    ui.setPreviewRunning();

    // Load current QML file if requested
    if (currentQmlFile) {
      // Give time for connection to establish
      await delay(500);
      logger.info('Loading QML file:', currentQmlFile);
      previewManager.loadUrl(currentQmlFile);
    }
  } catch (error) {
    ui.showFailedToStart(error);
    dispose();
    previewProcess.kill();
    previewProcess = undefined;
    return;
  }
}

export function registerStartQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.startQmlPreview`,
    async () => {
      await startQmlPreviewImpl({
        loadCurrentFile: false,
        action: 'startQmlPreview'
      });
    }
  );
}

export function registerStartQmlPreviewForCurrentFileCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.startQmlPreviewForCurrentFile`,
    async () => {
      await startQmlPreviewImpl({
        loadCurrentFile: true,
        action: 'startQmlPreviewForCurrentFile'
      });
    }
  );
}

export function registerAttachQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.attachQmlPreview`,
    async () => {
      telemetry.sendAction('attachQmlPreview');

      if (previewManager?.isConnected()) {
        ui.showAlreadyRunning();
        return;
      }

      const dispose = () => {
        if (previewManager) {
          previewManager.dispose();
          previewManager = undefined;
        }
        ui.setPreviewStopped();
      };

      // Ask user for host and port
      const connectionInfo = await ui.promptForConnectionInfo();
      if (!connectionInfo) {
        return;
      }

      const server: Server = {
        host: connectionInfo.host,
        port: connectionInfo.port,
        scheme: ServerScheme.Tcp
      };

      previewManager = new QmlPreviewConnectionManager();
      previewManager.setupFileWatcher();

      // Handle connection closed (when app exits)
      previewManager.onConnectionClosed(() => {
        logger.info('QML Preview connection closed');
        ui.showConnectionClosed();
        dispose();
      });

      // Set up FPS handler (log only)
      previewManager.setFpsHandler((fps: FpsInfo) => {
        // eslint-disable-next-line no-console
        console.log(
          `QML Preview: ${fps.numSyncs} fps (${fps.minSync}ms-${fps.maxSync}ms)`
        );
      });

      try {
        previewManager.connectToServer(server);
        ui.setPreviewRunning();
        ui.showAttachSuccess(connectionInfo.host, connectionInfo.port);
      } catch (error) {
        ui.showFailedToAttach(error);
        dispose();
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
        ui.showNotRunning();
        return;
      }

      previewManager.dispose();
      previewManager = undefined;

      if (previewProcess) {
        logger.info(
          `Killing QML Preview process with PID: ${previewProcess.pid}`
        );
        previewProcess.kill();
        previewProcess = undefined;
      }

      ui.setPreviewStopped();
      ui.showStopped();
    }
  );
}

export function registerReloadQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.reloadQmlPreview`,
    () => {
      telemetry.sendAction('reloadQmlPreview');

      if (!previewManager || !previewManager.isConnected()) {
        ui.showNotConnected();
        return;
      }

      previewManager.rerun();
      ui.showReloaded();
    }
  );
}

export function registerSetQmlPreviewZoomCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.setQmlPreviewZoom`,
    async () => {
      telemetry.sendAction('setQmlPreviewZoom');

      if (!previewManager || !previewManager.isConnected()) {
        ui.showNotConnected();
        return;
      }

      const zoom = await ui.promptForZoom();
      if (zoom === undefined) {
        return;
      }

      previewManager.zoom(zoom);
      ui.showZoomSet(zoom);
    }
  );
}

export function registerClearQmlPreviewCacheCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.clearQmlPreviewCache`,
    () => {
      telemetry.sendAction('clearQmlPreviewCache');

      if (!previewManager || !previewManager.isConnected()) {
        ui.showNotConnected();
        return;
      }

      previewManager.clearCache();
      ui.showCacheCleared();
    }
  );
}

export function disposePreviewManager() {
  if (previewManager) {
    previewManager.dispose();
    previewManager = undefined;
  }
  ui.setPreviewStopped();
}
