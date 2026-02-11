// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { createLogger, telemetry } from 'qt-lib';
import { EXTENSION_ID } from '@/constants.js';
import {
  launchQmlPreview,
  attachQmlPreview,
  disposeCurrentSession,
  getCurrentSession,
  setCurrentSession
} from '@/preview/preview-service.mjs';
import { FpsInfo } from '@/preview/preview-client.mjs';
import { QmlPreviewUI } from '@preview/ui.js';

const logger = createLogger('qml-preview');
const ui = new QmlPreviewUI();

function cleanupSession() {
  disposeCurrentSession();
  ui.setPreviewStopped();
}

async function startQmlPreviewImpl(options: { loadCurrentFile: boolean }) {
  if (getCurrentSession()?.manager.isConnected()) {
    ui.showAlreadyRunning();
    return;
  }

  let currentQmlFile: string | undefined;

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

  // Get default command line arguments from workspace settings
  const defaultArgs = vscode.workspace
    .getConfiguration('qt-qml.preview')
    .get<string[]>('args', []);

  const session = await launchQmlPreview(
    { qmlFile: currentQmlFile, args: defaultArgs },
    {
      onMessage: (msg) => {
        logger.info(msg);
      },
      onError: (err) => {
        logger.error(err);
        ui.showFailedToStart(new Error(err));
      },
      onConnectionClosed: () => {
        logger.info('QML Preview connection closed');
        cleanupSession();
      },
      onProcessExit: () => {
        logger.info('QML Preview process exited');
        cleanupSession();
      },
      onFps: (fps: FpsInfo) => {
        ui.updateFps(fps);
      }
    }
  );

  if (session) {
    setCurrentSession(session);
    ui.setPreviewRunning();
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
      if (getCurrentSession()?.manager.isConnected()) {
        ui.showAlreadyRunning();
        return;
      }

      const connectionInfo = await ui.promptForConnectionInfo();
      if (!connectionInfo) {
        return;
      }

      void ui.showWaitingForConnection(
        connectionInfo.host,
        connectionInfo.port,
        () => {
          logger.info('User canceled connection attempt');
          getCurrentSession()?.manager.cancelConnection();
          cleanupSession();
        }
      );

      const session = attachQmlPreview(
        {
          host: connectionInfo.host,
          port: connectionInfo.port
        },
        {
          onMessage: (msg) => {
            logger.info(msg);
          },
          onError: (err) => {
            logger.error(err);
          },
          onConnectionClosed: () => {
            logger.info('QML Preview connection closed in attach mode');
            cleanupSession();
          },
          onConnectionOpened: () => {
            logger.info('QML Preview connection opened');
            ui.setPreviewRunning();
            ui.showAttachSuccess(connectionInfo.host, connectionInfo.port);
          },
          onConnectionFailed: () => {
            logger.info('QML Preview connection failed');
            ui.showFailedToAttach(new Error('Connection failed'));
            cleanupSession();
          },
          onDebugServiceUnavailable: () => {
            logger.info('QML Preview debug service unavailable in attach mode');
            cleanupSession();
          }
        }
      );

      if (session) {
        setCurrentSession(session);
      }
    }
  );
}

export function registerStopQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.stopQmlPreview`,
    () => {
      telemetry.sendAction('stopQmlPreview');

      const session = getCurrentSession();
      if (!session) {
        ui.showNotRunning();
        return;
      }

      if (session.process) {
        logger.info(
          `Killing QML Preview process with PID: ${session.process.pid}`
        );
      }

      cleanupSession();
    }
  );
}

export function registerReloadQmlPreviewCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.reloadQmlPreview`,
    () => {
      telemetry.sendAction('reloadQmlPreview');

      const session = getCurrentSession();
      if (!session?.manager.isConnected()) {
        ui.showNotConnected();
        return;
      }

      session.manager.rerun();
      ui.showReloaded();
    }
  );
}

export function registerSetQmlPreviewZoomCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.setQmlPreviewZoom`,
    async () => {
      telemetry.sendAction('setQmlPreviewZoom');

      const session = getCurrentSession();
      if (!session?.manager.isConnected()) {
        ui.showNotConnected();
        return;
      }

      const zoom = await ui.promptForZoom();
      if (zoom === undefined) {
        return;
      }

      session.manager.zoom(zoom);
      ui.showZoomSet(zoom);
    }
  );
}

export function registerClearQmlPreviewCacheCommand() {
  return vscode.commands.registerCommand(
    `${EXTENSION_ID}.clearQmlPreviewCache`,
    () => {
      telemetry.sendAction('clearQmlPreviewCache');

      const session = getCurrentSession();
      if (!session?.manager.isConnected()) {
        ui.showNotConnected();
        return;
      }

      session.manager.clearCache();
      ui.showCacheCleared();
    }
  );
}

export function disposePreviewManager() {
  cleanupSession();
}
