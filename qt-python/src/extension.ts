// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import {
  PythonExtension as PyApi,
  ActiveEnvironmentPathChangeEvent as PyApiEnvChanged
} from '@vscode/python-extension';

import {
  CoreAPI,
  getCoreApi,
  createLogger,
  initLogger,
  getLogOutputChannel,
  telemetry
} from 'qt-lib';
import { PySideTaskProvider } from './task';
import { PySideCommandBuilder } from './builder';
import { PySideDebugConfigProvider } from './debug';
import { PySideProjectManager } from './project-manager';
import type { ProjectToolAction } from './types';
import * as consts from '@/constants';
import { onInstallPySide6Command } from './installer';

const logger = createLogger('extension');

export let pyApi: PyApi | undefined;
export let projectManager: PySideProjectManager;
export let coreApi: CoreAPI | undefined;

export async function activate(context: vscode.ExtensionContext) {
  initLogger(consts.LOG_NAME);
  logger.info(`Activate: ${consts.EXTENSION_ID}`);
  telemetry.activate(context);

  try {
    await initDependency();
    await initCoreApi();
    await initPythonSupport(context);
    initCommands(context);

    logger.info(`Activated: ${consts.EXTENSION_ID}`);
    telemetry.sendEvent('activated');
  } catch (e) {
    logger.error(`Cannot activate: ${consts.EXTENSION_ID}: ${String(e)}`);
  }
}

export function deactivate() {
  logger.info(`Deactivate: ${consts.EXTENSION_ID}`);
  telemetry.dispose();
}

// helpers
async function initDependency() {
  await vscode.extensions.getExtension(consts.MS_PYTHON_ID)?.activate();
}

async function initCoreApi() {
  coreApi = await getCoreApi();
  if (!coreApi) {
    throw new Error('Cannot get CoreAPI');
  }
}

async function initPythonSupport(context: vscode.ExtensionContext) {
  pyApi = await PyApi.api();
  projectManager = new PySideProjectManager(context);
  await projectManager.init();

  const task = new PySideTaskProvider();
  const debug = new PySideDebugConfigProvider();

  context.subscriptions.push(
    projectManager,
    pyApi.environments.onDidChangeActiveEnvironmentPath(onPyApiEnvChanged),
    vscode.tasks.registerTaskProvider(consts.TASK_TYPE, task),
    vscode.debug.registerDebugConfigurationProvider(consts.DEBUG_TYPE, debug)
  );
}

function initCommands(context: vscode.ExtensionContext) {
  type Callback = (...args: unknown[]) => unknown;

  function register(c: string, callback: Callback, useTelemetry = true) {
    return vscode.commands.registerCommand(
      `${consts.COMMAND_PREFIX}.${c}`,
      async () => {
        if (useTelemetry) {
          telemetry.sendAction(c);
        }

        await callback();
      }
    );
  }

  function registerWithArgs<T>(
    c: string,
    callback: (args?: T) => unknown,
    useTelemetry = true
  ) {
    return vscode.commands.registerCommand(
      `${consts.COMMAND_PREFIX}.${c}`,
      (args?: T) => {
        if (useTelemetry) {
          telemetry.sendAction(c);
        }

        return callback(args);
      }
    );
  }

  context.subscriptions.push(
    register(consts.COMMAND_SHOW_LOG, onShowLog, false),
    register(consts.COMMAND_INSTALL_PYSIDE, onInstallPySide6Command),
    registerWithArgs(consts.COMMAND_RUN, async (args?: string) =>
      getPySideCommand(consts.COMMAND_RUN, args)
    ),
    registerWithArgs(consts.COMMAND_BUILD, async (args?: string) =>
      getPySideCommand(consts.COMMAND_BUILD, args)
    ),
    registerWithArgs(consts.COMMAND_CLEAN, async (args?: string) =>
      getPySideCommand(consts.COMMAND_CLEAN, args)
    ),
    registerWithArgs(consts.COMMAND_DEPLOY, async (args?: string) =>
      getPySideCommand(consts.COMMAND_DEPLOY, args)
    )
  );
}

async function getPySideCommand(action: ProjectToolAction, args?: string) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  const project = projectManager.getProject(folder);
  const env = project?.env;
  if (!env) {
    return undefined;
  }

  const cmdString = args
    ? `pyside6-project ${action} ${args}`
    : `pyside6-project ${action}`;

  const cmd = new PySideCommandBuilder()
    .useVenv(true)
    .venvBinPath(env.venvBinPath)
    .cwd(folder.uri.fsPath)
    .build(cmdString);

  // Spawn the process using vscode tasks API
  const execution = new vscode.ShellExecution(cmd.commandLine, {
    cwd: folder.uri.fsPath,
    executable: cmd.shellPath,
    shellArgs: cmd.shellArgs
  });

  const task = new vscode.Task(
    { type: 'pyside', action },
    folder,
    `PySide ${action}`,
    'qt-python',
    execution
  );

  const taskExecution = await vscode.tasks.executeTask(task);
  return taskExecution;
}

const onPyApiEnvChanged = async (e: PyApiEnvChanged) => {
  const folder = e.resource;
  if (folder) {
    logger.info(`Active environment changed: ${folder.uri.fsPath}`);
    await projectManager.refreshProjectEnv(folder);
  }
};

function onShowLog() {
  getLogOutputChannel()?.show();
}
