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

/**
 * Options for launching QML Preview
 */
export interface QmlPreviewLaunchOptions {
  /**
   * Path to the program to be launched
   * If not specified, uses cmake.launchTargetPath
   */
  program?: string | undefined;
  /**
   * QML file to load in preview (optional)
   */
  qmlFile?: string | undefined;
  /**
   * Host address for the preview connection
   * Default: '127.0.0.1'
   */
  host?: string | undefined;
  /**
   * Port for the preview connection
   * If not specified, a free port will be auto-assigned
   */
  port?: number | undefined;
  /**
   * Additional build directories for QRC file resolution
   */
  buildDirs?: string[] | undefined;
  /**
   * Additional command line arguments passed to the program
   */
  args?: string[] | undefined;
}

/**
 * Options for attaching to QML Preview
 */
export interface QmlPreviewAttachOptions {
  /**
   * Host address to attach to
   */
  host: string;
  /**
   * Port to attach to
   */
  port: number;
  /**
   * Additional build directories for QRC file resolution
   */
  buildDirs?: string[] | undefined;
}

/**
 * Callbacks for QML Preview events
 */
export interface QmlPreviewCallbacks {
  /**
   * Called when a message should be logged/displayed
   */
  onMessage?: (message: string) => void;
  /**
   * Called when an error occurs
   */
  onError?: (error: string) => void;
  /**
   * Called when the preview connection is closed
   */
  onConnectionClosed?: () => void;
  /**
   * Called when the preview connection is opened
   */
  onConnectionOpened?: () => void;
  /**
   * Called when the preview connection fails
   */
  onConnectionFailed?: () => void;
  /**
   * Called when the preview process exits
   */
  onProcessExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /**
   * Called with FPS info updates
   */
  onFps?: (fps: FpsInfo) => void;
  /**
   * Called when debug service is unavailable
   */
  onDebugServiceUnavailable?: () => void;
}

/**
 * Result of a QML Preview launch or attach operation
 */
export interface QmlPreviewSession {
  /**
   * The preview connection manager
   */
  manager: QmlPreviewConnectionManager;
  /**
   * The preview process (only for launch)
   */
  process?: QtProcess;
  /**
   * Server connection info
   */
  server: Server;
}

/**
 * Creates and configures a QmlPreviewConnectionManager
 */
export function createPreviewManager(
  buildDirs?: string[],
  callbacks?: QmlPreviewCallbacks
): QmlPreviewConnectionManager {
  const manager = new QmlPreviewConnectionManager();
  manager.setupFileWatcher();

  // Configure build directories for QRC file resolution
  const additionalBuildDirs = vscode.workspace
    .getConfiguration('qt-qml.preview')
    .get<string[]>('additionalBuildDirs', []);
  const projectBuildDirs = projectManager.getBuildDirs();
  manager.buildDirs = [
    ...projectBuildDirs,
    ...additionalBuildDirs,
    ...(buildDirs ?? [])
  ];

  // Set up event handlers if callbacks provided
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

/**
 * Gets the program path, either from options or from cmake.launchTargetPath
 */
export async function resolveProgram(
  program?: string
): Promise<string | undefined> {
  if (program) {
    return program;
  }
  const ret = await vscode.commands.executeCommand('cmake.launchTargetPath');
  return ret as string | undefined;
}

/**
 * Gets a free port or uses the specified one
 */
export async function resolvePort(port?: number): Promise<number | undefined> {
  if (port) {
    return port;
  }
  return getPort();
}

/**
 * Builds the preview debugger arguments string
 */
export function buildPreviewArgs(host: string, port: number): string {
  return `-qmljsdebugger=host:${host},port:${port},block,services:QmlPreview,DebugTranslation`;
}

/**
 * Launches a QML Preview session
 * @returns The preview session or undefined if launch failed
 */
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

  // Resolve program path
  const program = await resolveProgram(options.program);
  if (!program) {
    error('Failed to get launch target executable');
    return undefined;
  }
  log(`Program: ${program}`);

  // Resolve host and port
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

  // Create preview manager
  const manager = createPreviewManager(options.buildDirs, callbacks);

  // Build command
  const previewArgs = buildPreviewArgs(host, port);
  const additionalArgs = options.args ?? [];
  const command = `${program} ${previewArgs}`;
  log(`Command: ${command} ${additionalArgs.join(' ')}`);

  try {
    // Spawn process
    const process = await spawnProcessForTool(command, additionalArgs);

    if (process.killed || process.pid === undefined) {
      error('Failed to start QML Preview process');
      manager.dispose();
      return undefined;
    }
    log(`QML Preview process started with PID: ${process.pid}`);

    // Handle process exit
    process.on('exit', (code, signal) => {
      log(`QML Preview process exited with code ${code}, signal ${signal}`);
      callbacks?.onProcessExit?.(code, signal);
    });

    // Connect to server
    manager.connectToServer(server);
    log('QML Preview connected successfully');

    // Load QML file if specified
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

/**
 * Attaches to an existing QML Preview session
 * @returns The preview session or undefined if attach failed
 */
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

  // Create preview manager
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

/**
 * Disposes a QML Preview session
 */
export function disposeSession(session: QmlPreviewSession | undefined) {
  if (!session) {
    return;
  }
  session.manager.dispose();
  session.process?.kill();
}
