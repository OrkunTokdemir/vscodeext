// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { createLogger } from 'qt-lib';
import {
  // DebugMessageClient,
  // QmlDebugConnectionManager,
  Server,
  ServerScheme
} from '@debug/debug-connection';
import { LoggingDebugSession } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { QmlEngine } from '@debug/qml-engine';

const logger = createLogger('project');

export function registerQmlDebugAdapterFactory() {
  return vscode.debug.registerDebugAdapterDescriptorFactory(
    'qml',
    new QmlDebugAdapterFactory()
  );
}

interface QmlDebugSessionAttachArguments
  extends DebugProtocol.AttachRequestArguments {
  host: string;
  port: number;
  paths: Record<string, string>;
}

export class QmlDebugSession extends LoggingDebugSession {
  // private _debugMessageClient: DebugMessageClient | undefined;
  // private _QmlDebugConnectionManager: QmlDebugConnectionManager | undefined;
  private _qmlEngine: QmlEngine | undefined;
  public constructor(session: vscode.DebugSession) {
    super();

    logger.info('Creating debug session for session:', session.id);
  }
  protected override attachRequest(
    response: DebugProtocol.AttachResponse,
    args: QmlDebugSessionAttachArguments,
    request?: DebugProtocol.Request
  ) {
    // logger.info('response:', response.toString());
    void request;
    logger.info(
      'Attach request:',
      args.host,
      args.port.toString(),
      JSON.stringify(Object.fromEntries(Object.entries(args.paths)))
    );
    const server: Server = {
      host: args.host,
      port: args.port,
      scheme: ServerScheme.Tcp
    };
    try {
      // this._QmlDebugConnectionManager = new QmlDebugConnectionManager();
      // this._QmlDebugConnectionManager.connectToServer(server);

      // const connection = this._QmlDebugConnectionManager.connection;
      // if (!connection) {
      //   throw new Error('Connection is not established');
      // }
      // this._debugMessageClient = new DebugMessageClient(connection);
      // void this._debugMessageClient;
      this._qmlEngine = new QmlEngine();
      this._qmlEngine.server = server;
      this._qmlEngine.setupEngine();

      this.sendResponse(response);
    } catch (error) {
      logger.error('Error:', (error as Error).message);
    }
  }
}

export class QmlDebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  public createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    logger.info('Creating debug adapter for session:', session.id);
    logger.info('Executable:', executable?.command ?? 'undefined');

    return new vscode.DebugAdapterInlineImplementation(
      new QmlDebugSession(session)
    );
  }
}
