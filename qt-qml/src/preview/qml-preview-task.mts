// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { telemetry } from 'qt-lib';
import {
  launchQmlPreview,
  attachQmlPreview,
  disposeSession,
  setCurrentSession,
  QmlPreviewSession,
  QmlPreviewLaunchOptions,
  QmlPreviewAttachOptions
} from '@preview/qml-preview-service.mjs';
import { QmlPreviewUI } from '@preview/ui.js';

/**
 * Task definition for QML Preview Launch
 */
export interface QmlPreviewLaunchTaskDefinition extends vscode.TaskDefinition {
  type: 'qmlpreview-launch';
  /**
   * Path to the program to be launched
   */
  program?: string;
  /**
   * QML file to load in preview (optional)
   */
  qmlFile?: string;
  /**
   * Host address for the preview connection
   */
  host?: string;
  /**
   * Port for the preview connection (optional, auto-assigned if not specified)
   */
  port?: number;
  /**
   * Additional build directories for QRC file resolution
   */
  buildDirs?: string[];
  /**
   * Additional command line arguments passed to the program
   */
  args?: string[];
}

/**
 * Task definition for QML Preview Attach
 */
export interface QmlPreviewAttachTaskDefinition extends vscode.TaskDefinition {
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
  buildDirs?: string[];
}

/**
 * Terminal implementation for QML Preview tasks
 * Handles the lifecycle of preview connections and processes
 */
class QmlPreviewTaskTerminal implements vscode.Pseudoterminal {
  private readonly _writeEmitter = new vscode.EventEmitter<string>();
  private readonly _closeEmitter = new vscode.EventEmitter<number>();
  private _session: QmlPreviewSession | undefined;
  private readonly _ui = new QmlPreviewUI();

  public get onDidWrite() {
    return this._writeEmitter.event;
  }

  public get onDidClose() {
    return this._closeEmitter.event;
  }

  constructor(
    private readonly _mode: 'launch' | 'attach',
    private readonly _definition:
      | QmlPreviewLaunchTaskDefinition
      | QmlPreviewAttachTaskDefinition
  ) {}

  async open() {
    if (this._mode === 'launch') {
      await this.launch(this._definition as QmlPreviewLaunchTaskDefinition);
    } else {
      this.attach(this._definition as QmlPreviewAttachTaskDefinition);
    }
  }

  close() {
    this.cleanup();
    this._closeEmitter.fire(0);
  }

  private write(message: string) {
    this._writeEmitter.fire(message + '\r\n');
  }

  private cleanup() {
    disposeSession(this._session);
    this._session = undefined;
    setCurrentSession(undefined);
    this._ui.setPreviewStopped();
  }

  private async resolveVariables(value: string | undefined) {
    if (!value) {
      return undefined;
    }

    // Resolve ${command:...} variables
    const commandRegex = /\$\{command:([^}]+)\}/g;
    let resolved = value;
    const matches = value.matchAll(commandRegex);

    for (const match of matches) {
      const commandId = match[1];
      if (!commandId) {
        continue;
      }

      try {
        const result = await vscode.commands.executeCommand(commandId);
        if (typeof result === 'string') {
          resolved = resolved.replace(match[0], result);
        }
      } catch (error) {
        this.write(
          `Warning: Failed to resolve command '${commandId}': ${String(error)}`
        );
      }
    }

    return resolved;
  }

  private async launch(definition: QmlPreviewLaunchTaskDefinition) {
    telemetry.sendAction('qmlPreviewTaskLaunch');
    this.write('Starting QML Preview Launch task...');

    const program = await this.resolveVariables(definition.program);
    const qmlFile = await this.resolveVariables(definition.qmlFile);

    const options: QmlPreviewLaunchOptions = {
      program,
      qmlFile,
      host: definition.host,
      port: definition.port,
      buildDirs: definition.buildDirs,
      args: definition.args
    };

    this._session = await launchQmlPreview(options, {
      onMessage: (msg) => {
        this.write(msg);
      },
      onError: (err) => {
        this.write(`Error: ${err}`);
      },
      onConnectionClosed: () => {
        this.write('QML Preview connection closed');
        this.cleanup();
        this._closeEmitter.fire(0);
      },
      onProcessExit: (code, signal) => {
        this.write(
          `QML Preview process exited with code ${code}, signal ${signal}`
        );
        this.cleanup();
        this._closeEmitter.fire(code ?? 0);
      },
      onFps: (fps) => {
        this._ui.updateFps(fps);
      }
    });

    if (this._session) {
      setCurrentSession(this._session);
      this._ui.setPreviewRunning();

      this._session.process?.stdout?.on('data', (data: Buffer) => {
        this.write(`[stdout] ${data.toString().trim()}`);
      });
      this._session.process?.stderr?.on('data', (data: Buffer) => {
        this.write(`[stderr] ${data.toString().trim()}`);
      });
    } else {
      this._closeEmitter.fire(1);
    }
  }

  private attach(definition: QmlPreviewAttachTaskDefinition) {
    telemetry.sendAction('qmlPreviewTaskAttach');
    this.write('Starting QML Preview Attach task...');

    const options: QmlPreviewAttachOptions = {
      host: definition.host,
      port: definition.port,
      buildDirs: definition.buildDirs
    };

    this._session = attachQmlPreview(options, {
      onMessage: (msg) => {
        this.write(msg);
      },
      onError: (err) => {
        this.write(`Error: ${err}`);
      },
      onConnectionClosed: () => {
        this.write('QML Preview connection closed');
        this.cleanup();
        this._closeEmitter.fire(0);
      },
      onConnectionOpened: () => {
        this.write('QML Preview connection established');
        this._ui.setPreviewRunning();
      },
      onConnectionFailed: () => {
        this.write('Error: QML Preview connection failed');
        this.cleanup();
        this._closeEmitter.fire(1);
      },
      onDebugServiceUnavailable: () => {
        this.write('Error: QML Preview debug service unavailable');
        this.cleanup();
        this._closeEmitter.fire(1);
      },
      onFps: (fps) => {
        this._ui.updateFps(fps);
      }
    });

    if (this._session) {
      setCurrentSession(this._session);
    } else {
      this._closeEmitter.fire(1);
    }
  }
}

/**
 * Task provider for QML Preview Launch tasks
 */
export class QmlPreviewLaunchTaskProvider implements vscode.TaskProvider {
  static readonly type = 'qmlpreview-launch';

  private static createTask(
    definition: QmlPreviewLaunchTaskDefinition
  ): vscode.Task {
    // eslint-disable-next-line @typescript-eslint/require-await
    const taskCallback = async (): Promise<QmlPreviewTaskTerminal> => {
      return new QmlPreviewTaskTerminal('launch', definition);
    };

    return new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      'QML Preview Launch',
      QmlPreviewLaunchTaskProvider.type,
      new vscode.CustomExecution(taskCallback),
      []
    );
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  public provideTasks(): vscode.Task[] {
    // Provide default launch task
    const definition: QmlPreviewLaunchTaskDefinition = {
      type: QmlPreviewLaunchTaskProvider.type
    };
    return [QmlPreviewLaunchTaskProvider.createTask(definition)];
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  public resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as QmlPreviewLaunchTaskDefinition;
    return QmlPreviewLaunchTaskProvider.createTask(definition);
  }
}

/**
 * Task provider for QML Preview Attach tasks
 */
export class QmlPreviewAttachTaskProvider implements vscode.TaskProvider {
  static readonly type = 'qmlpreview-attach';

  private static createTask(
    definition: QmlPreviewAttachTaskDefinition
  ): vscode.Task {
    // eslint-disable-next-line @typescript-eslint/require-await
    const taskCallback = async (): Promise<QmlPreviewTaskTerminal> => {
      return new QmlPreviewTaskTerminal('attach', definition);
    };

    return new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      'QML Preview Attach',
      QmlPreviewAttachTaskProvider.type,
      new vscode.CustomExecution(taskCallback),
      []
    );
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  public provideTasks(): vscode.Task[] {
    // Provide default attach task (requires user configuration)
    const definition: QmlPreviewAttachTaskDefinition = {
      type: QmlPreviewAttachTaskProvider.type,
      host: 'localhost',
      port: 12150
    };
    return [QmlPreviewAttachTaskProvider.createTask(definition)];
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  public resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as QmlPreviewAttachTaskDefinition;
    return QmlPreviewAttachTaskProvider.createTask(definition);
  }
}

export const qmlPreviewLaunchTaskProvider = new QmlPreviewLaunchTaskProvider();
export const qmlPreviewAttachTaskProvider = new QmlPreviewAttachTaskProvider();
