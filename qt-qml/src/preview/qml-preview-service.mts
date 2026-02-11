// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import getPort from 'get-port';

import { createLogger, delay } from 'qt-lib';
import { projectManager } from '@/extension.mjs';
import { QmlPreviewConnectionManager } from '@preview/qml-preview-connection-manager.mjs';
import { FpsInfo } from '@preview/qml-preview-client.mjs';
import { Server, ServerScheme } from '@debug/debug-connection.mjs';
import { QtProcess, spawnProcessForTool } from '@/utils.mts';

const logger = createLogger('qml-preview-service');

let qmlPreviewOutputChannel: vscode.OutputChannel | undefined;

export interface QmlPreviewLaunchOptions {
  program?: string | undefined;
  qmlFile?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  buildDirs?: string[] | undefined;
  args?: string[] | undefined;
}

export interface QmlPreviewAttachOptions {
  host: string;
  port: number;
  buildDirs?: string[] | undefined;
}

export interface QmlPreviewCallbacks {
  onMessage?: (message: string) => void;
  onError?: (error: string) => void;
  onConnectionClosed?: () => void;
  onConnectionOpened?: () => void;
  onConnectionFailed?: () => void;
  onProcessExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onFps?: (fps: FpsInfo) => void;
  onDebugServiceUnavailable?: () => void;
}

export interface QmlPreviewSession {
  manager: QmlPreviewConnectionManager;
  process?: QtProcess;
  server: Server;
}

export function createPreviewManager(
  buildDirs?: string[],
  callbacks?: QmlPreviewCallbacks
): QmlPreviewConnectionManager {
  const manager = new QmlPreviewConnectionManager();
  manager.setupFileWatcher();

  const additionalBuildDirs = vscode.workspace
    .getConfiguration('qt-qml.preview')
    .get<string[]>('additionalBuildDirs', []);
  const projectBuildDirs = projectManager.getBuildDirs();
  manager.buildDirs = [
    ...projectBuildDirs,
    ...additionalBuildDirs,
    ...(buildDirs ?? [])
  ];

  if (callbacks) {
    if (callbacks.onConnectionClosed) {
      manager.onConnectionClosed(callbacks.onConnectionClosed);
    }
    if (callbacks.onConnectionOpened) {
      manager.onConnectionOpened(callbacks.onConnectionOpened);
    }
    if (callbacks.onConnectionFailed) {
      manager.onConnectionFailed(callbacks.onConnectionFailed);
    }
    if (callbacks.onDebugServiceUnavailable) {
      manager.onDebugServiceUnavailable(callbacks.onDebugServiceUnavailable);
    }
    if (callbacks.onFps) {
      manager.setFpsHandler(callbacks.onFps);
    }
  }

  return manager;
}

export async function resolveProgram(program?: string) {
  if (program) {
    return program;
  }
  const ret = await vscode.commands.executeCommand('cmake.launchTargetPath');
  return ret as string | undefined;
}

export async function resolvePort(port?: number) {
  if (port) {
    return port;
  }
  return getPort();
}

export function buildPreviewArgs(host: string, port: number) {
  return `-qmljsdebugger=host:${host},port:${port},block,services:QmlPreview,DebugTranslation`;
}

export async function launchQmlPreview(
  options: QmlPreviewLaunchOptions,
  callbacks?: QmlPreviewCallbacks
): Promise<QmlPreviewSession | undefined> {
  const log = (msg: string) => {
    logger.info(msg);
    callbacks?.onMessage?.(msg);
  };
  const error = (msg: string) => {
    logger.error(msg);
    callbacks?.onError?.(msg);
  };

  const program = await resolveProgram(options.program);
  if (!program) {
    error('Failed to get launch target executable');
    return undefined;
  }
  log(`Program: ${program}`);

  const host = options.host ?? '127.0.0.1';
  const port = await resolvePort(options.port);
  if (!port) {
    error('Failed to obtain a free port');
    return undefined;
  }
  log(`Host: ${host}, Port: ${port}`);

  const server: Server = {
    host,
    port,
    scheme: ServerScheme.Tcp
  };

  const manager = createPreviewManager(options.buildDirs, callbacks);

  const previewArgs = buildPreviewArgs(host, port);
  const additionalArgs = options.args ?? [];
  const command = `${program} ${previewArgs}`;
  log(`Command: ${command} ${additionalArgs.join(' ')}`);

  try {
    const process = await spawnProcessForTool(command, additionalArgs);

    if (process.killed || process.pid === undefined) {
      error('Failed to start QML Preview process');
      manager.dispose();
      return undefined;
    }
    log(`QML Preview process started with PID: ${process.pid}`);

    if (!qmlPreviewOutputChannel) {
      qmlPreviewOutputChannel =
        vscode.window.createOutputChannel('QML Preview Output');
    }

    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        qmlPreviewOutputChannel?.append(output);
      });
    }

    if (process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        qmlPreviewOutputChannel?.append(output);
      });
    }

    qmlPreviewOutputChannel.show(true);

    process.on('exit', (code, signal) => {
      log(`QML Preview process exited with code ${code}, signal ${signal}`);
      callbacks?.onProcessExit?.(code, signal);
    });

    manager.connectToServer(server);
    log('QML Preview connected successfully');

    if (options.qmlFile) {
      await delay(500);
      log(`Loading QML file: ${options.qmlFile}`);
      manager.loadUrl(options.qmlFile);
    }

    return { manager, process, server };
  } catch (err) {
    error(`Failed to start QML Preview: ${String(err)}`);
    manager.dispose();
    return undefined;
  }
}

export function attachQmlPreview(
  options: QmlPreviewAttachOptions,
  callbacks?: QmlPreviewCallbacks
): QmlPreviewSession | undefined {
  const log = (msg: string) => {
    logger.info(msg);
    callbacks?.onMessage?.(msg);
  };
  const error = (msg: string) => {
    logger.error(msg);
    callbacks?.onError?.(msg);
  };

  if (!options.host || !options.port) {
    error('Host and port are required for attach');
    return undefined;
  }
  log(`Attaching to ${options.host}:${options.port}...`);

  const server: Server = {
    host: options.host,
    port: options.port,
    scheme: ServerScheme.Tcp
  };

  const manager = createPreviewManager(options.buildDirs, callbacks);

  try {
    manager.connectToServer(server);
    log(`Waiting for connection to ${options.host}:${options.port}...`);
    return { manager, server };
  } catch (err) {
    error(`Failed to attach to QML Preview: ${String(err)}`);
    manager.dispose();
    return undefined;
  }
}

export function disposeSession(session: QmlPreviewSession | undefined) {
  if (!session) {
    return;
  }
  session.manager.dispose();
  session.process?.kill();
  qmlPreviewOutputChannel?.dispose();
  qmlPreviewOutputChannel = undefined;
}

// Shared session management for both command-based and task-based preview
let currentSession: QmlPreviewSession | undefined;

export function setCurrentSession(session: QmlPreviewSession | undefined) {
  currentSession = session;
}

export function getCurrentSession(): QmlPreviewSession | undefined {
  return currentSession;
}

export function disposeCurrentSession() {
  disposeSession(currentSession);
  currentSession = undefined;
}
