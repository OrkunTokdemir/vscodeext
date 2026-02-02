// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { createLogger, delay, telemetry } from 'qt-lib';
import { EXTENSION_ID } from '@/constants.js';
import { projectManager } from '@/extension.mjs';
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

async function startQmlPreviewImpl(options: { loadCurrentFile: boolean }) {
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

  // Configure build directories for QRC file resolution
  const additionalBuildDirs = vscode.workspace
    .getConfiguration('qt-qml.preview')
    .get<string[]>('additionalBuildDirs', []);
  const projectBuildDirs = projectManager.getBuildDirs();
  previewManager.buildDirs = [...projectBuildDirs, ...additionalBuildDirs];

  // Handle connection closed (when app exits or user closes preview window)
  previewManager.onConnectionClosed(() => {
    logger.info('QML Preview connection closed');
    ui.showConnectionClosed();
    // Only dispose if not already disposed by process exit
    if (previewManager) {
      previewManager.dispose();
      previewManager = undefined;
    }
    ui.setPreviewStopped();
    if (previewProcess) {
      previewProcess.kill();
      previewProcess = undefined;
    }
  });

  // Set up FPS handler to display in status bar
  previewManager.setFpsHandler((fps: FpsInfo) => {
    ui.updateFps(fps);
  });

  // -qmljsdebugger=host:127.0.0.1,port:12150,block,services:QmlPreview,DebugTranslation
  const ret = await vscode.commands.executeCommand('cmake.launchTargetPath');
  const program = ret as string;
  if (!program) {
    ui.showFailedToGetLaunchTarget();
    previewManager.dispose();
    previewManager = undefined;
    ui.setPreviewStopped();
    return;
  }

  const previewArgs = `-qmljsdebugger=host:${server.host},port:${server.port},block,services:QmlPreview,DebugTranslation`;
  // Don't pass QML file on command line - load it via debug protocol after connection
  // This prevents the app from briefly showing its default UI before loading the target file
  const command = `${program} ${previewArgs}`;
  logger.info('Starting QML Preview with command:', command);

  previewProcess = await spawnProcessForTool(command, []);
  // Check if the process started successfully
  if (previewProcess.killed || previewProcess.pid === undefined) {
    ui.showFailedToStartProcess();
    previewManager.dispose();
    previewManager = undefined;
    ui.setPreviewStopped();
    return;
  }
  logger.info(`QML Preview process started with PID: ${previewProcess.pid}`);

  // Handle process exit (when user closes the preview window or process crashes)
  previewProcess.on('exit', () => {
    logger.info('QML Preview process exited');
    // Only dispose if not already disposed by connection closed
    if (previewManager) {
      previewManager.dispose();
      previewManager = undefined;
    }
    ui.setPreviewStopped();
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
    previewManager.dispose();
    previewManager = undefined;
    ui.setPreviewStopped();
    previewProcess.kill();
    previewProcess = undefined;
    return;
  }
}

export function registerStartQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.startQmlPreview`,
    async () => {
      logger.info('Starting QML Preview');
      telemetry.sendAction('startQmlPreview');
      await startQmlPreviewImpl({
        loadCurrentFile: false
      });
    }
  );
}

export function registerStartQmlPreviewForCurrentFileCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.startQmlPreviewForCurrentFile`,
    async () => {
      logger.info('Starting QML Preview for current file');
      telemetry.sendAction('startQmlPreviewForCurrentFile');
      await startQmlPreviewImpl({
        loadCurrentFile: true
      });
    }
  );
}

export function registerAttachQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.attachQmlPreview`,
    async () => {
      logger.info('Attaching to QML Preview');
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

      // Configure build directories for QRC file resolution
      const additionalBuildDirs = vscode.workspace
        .getConfiguration('qt-qml.preview')
        .get<string[]>('additionalBuildDirs', []);
      const projectBuildDirs = projectManager.getBuildDirs();
      previewManager.buildDirs = [...projectBuildDirs, ...additionalBuildDirs];

      // Show waiting notification with cancel callback
      void ui.showWaitingForConnection(
        connectionInfo.host,
        connectionInfo.port,
        () => {
          // User clicked cancel
          logger.info('User canceled connection attempt');
          if (previewManager) {
            previewManager.cancelConnection();
          }
          dispose();
        }
      );

      // Handle connection closed (when app exits)
      previewManager.onConnectionClosed(() => {
        logger.info('QML Preview connection closed');
        ui.showConnectionClosed();
        dispose();
      });

      // Handle connection opened
      previewManager.onConnectionOpened(() => {
        logger.info('QML Preview connection opened');
        ui.setPreviewRunning();
        ui.showAttachSuccess(connectionInfo.host, connectionInfo.port);
      });

      // Handle connection failed
      previewManager.onConnectionFailed(() => {
        logger.info('QML Preview connection failed');
        ui.showFailedToAttach(new Error('Connection failed'));
        dispose();
      });

      // Set up FPS handler (log only)
      previewManager.setFpsHandler((fps: FpsInfo) => {
        // eslint-disable-next-line no-console
        console.log(
          `QML Preview: ${fps.numSyncs} fps (${fps.minSync}ms-${fps.maxSync}ms)`
        );
      });

      // Initiate connection (events will handle success/failure)
      previewManager.connectToServer(server);
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
