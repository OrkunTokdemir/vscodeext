// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { createLogger, getFilename } from 'qt-lib';
import {
  // DebugMessageClient,
  // QmlDebugConnectionManager,
  Server,
  ServerScheme
} from '@debug/debug-connection';
import {
  InitializedEvent,
  LoggingDebugSession,
  Thread
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { QmlEngine } from '@debug/qml-engine';

const logger = createLogger('project');

export function registerQmlDebugAdapterFactory() {
  return vscode.debug.registerDebugAdapterDescriptorFactory(
    'qml',
    new QmlDebugAdapterFactory()
  );
}

export enum BreakpointState {
  BreakpointNew,
  BreakpointInsertionRequested, //!< Inferior was told about bp, not ack'ed.
  BreakpointInsertionProceeding,
  BreakpointInserted,
  BreakpointUpdateRequested,
  BreakpointUpdateProceeding,
  BreakpointRemoveRequested,
  BreakpointRemoveProceeding,
  BreakpointDead
}

interface QmlDebugSessionAttachArguments
  extends DebugProtocol.AttachRequestArguments {
  host: string;
  port: number;
  paths: Record<string, string>;
}

export interface SetBreakpointResult {
  // type : "response";
  request_seq: number;
  // command : string;
  success: boolean;
  // running : boolean;
}

export interface QmlBreakpoint {
  id?: number;
  filename: string;
  line: number;
  state: BreakpointState;
}

export class QmlDebugSession extends LoggingDebugSession {
  // private _debugMessageClient: DebugMessageClient | undefined;
  // private _QmlDebugConnectionManager: QmlDebugConnectionManager | undefined;
  private _qmlEngine: QmlEngine | undefined;
  private readonly _breakpoints: QmlBreakpoint[] = [];
  public constructor(session: vscode.DebugSession) {
    super();

    logger.info('Creating debug session for session:', session.id);
  }
  findBreakpoint(filename: string, line: number): QmlBreakpoint | undefined {
    for (const breakpoint of this._breakpoints) {
      if (breakpoint.filename === filename && breakpoint.line === line) {
        return breakpoint;
      }
    }
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  protected override async disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments,
    request?: DebugProtocol.Request
  ): Promise<void> {
    logger.info('Disconnect request:');
    this._qmlEngine?.closeConnection();
    void args;
    void request;
    this.sendResponse(response);
  }
  // Since it is a an external api, we can't change the signature
  // Disable eslint rule
  // eslint-disable-next-line @typescript-eslint/require-await
  protected override async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments,
    request?: DebugProtocol.Request
  ): Promise<void> {
    logger.info('Func: setBreakPointsRequest: Begin');
    void request;
    const breakpointstoRemove: QmlBreakpoint[] = [];
    // void breakpointstoRemove;
    const breakpointsToAdd: QmlBreakpoint[] = [];
    if (!args.breakpoints) {
      // clear all breakpoints for this file
      logger.error('No breakpoints');
      return;
    }
    for (const breakpoint of args.breakpoints) {
      if (!args.source.path) {
        continue;
      }
      const existingBreakpoint = this.findBreakpoint(
        args.source.path,
        breakpoint.line
      );
      if (existingBreakpoint) {
        breakpointstoRemove.push(existingBreakpoint);
      } else {
        const newBreakpoint: QmlBreakpoint = {
          filename: getFilename(args.source.path),
          line: breakpoint.line,
          state: BreakpointState.BreakpointInsertionRequested
        };
        this._breakpoints.push(newBreakpoint);
        breakpointsToAdd.push(newBreakpoint);
      }
    }
    for (const breakpoint of breakpointstoRemove) {
      const index = this._breakpoints.indexOf(breakpoint);
      this._breakpoints.splice(index, 1);
    }
    if (!this._qmlEngine) {
      throw new Error('QmlEngine not initialized');
    }
    response.body = {
      breakpoints: []
    };
    for (const breakpoint of breakpointsToAdd) {
      const seq = this._qmlEngine.tryClaimBreakpoint(breakpoint);
      if (seq !== undefined) {
        response.body.breakpoints.push({
          id: seq,
          line: breakpoint.line,
          verified: true
        });
      }
    }
    response.success = true;
    // print response
    logger.info('setBreakPointsRequest response:', JSON.stringify(response));
    // TODO: Fill response.body otherwise breakpoints will not be set
    this.sendResponse(response);
  }
  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse,
    args: DebugProtocol.InitializeRequestArguments
  ) {
    logger.info('Initialize request:', JSON.stringify(args));
    response.body = {};
    this.sendResponse(response);
  }
  protected override setFunctionBreakPointsRequest(
    response: DebugProtocol.SetFunctionBreakpointsResponse,
    args: DebugProtocol.SetFunctionBreakpointsArguments,
    request?: DebugProtocol.Request
  ): void {
    logger.info('Function breakpoints:');
    void this;
    void response;
    void args;
    void request;
  }
  protected override threadsRequest(
    response: DebugProtocol.ThreadsResponse,
    request?: DebugProtocol.Request
  ) {
    logger.info('threadsRequest:');
    void request;
    if (!this._qmlEngine) {
      throw new Error('QmlEngine not initialized');
    }
    response.body = {
      threads: [new Thread(this._qmlEngine.mainQmlThreadId, 'Main Thread')]
    };
    this.sendResponse(response);
  }
  protected override async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments,
    request?: DebugProtocol.Request
  ) {
    if (!this._qmlEngine) {
      throw new Error('QmlEngine not initialized');
    }
    logger.info('stackTraceRequest:', JSON.stringify(args));
    response.body = {
      stackFrames: []
    };
    void request;
    void this;
    // response.success = true;
    await this._qmlEngine.backtrace(response, args);
    // response.body = {
    //   stackFrames: [
    //     {
    //       id: 0,
    //       source: {
    //         name: 'Main.qml',
    //         path: '/home/orkun/qt_work/qt_projects/calqlatr/Main.qml',
    //         sourceReference: 0
    //       },
    //       line: 92,
    //       column: 0,
    //       name: 'digitPressed'
    //     }
    //   ],
    //   totalFrames: 2
    // };
    this.sendResponse(response);
  }
  protected override continueRequest(
    response: DebugProtocol.ContinueResponse,
    args: DebugProtocol.ContinueArguments,
    request?: DebugProtocol.Request
  ) {
    if (!this._qmlEngine) {
      throw new Error('QmlEngine not initialized');
    }
    void response;
    void request;
    void args;
  }

  protected override setExceptionBreakPointsRequest(
    response: DebugProtocol.SetExceptionBreakpointsResponse,
    args: DebugProtocol.SetExceptionBreakpointsArguments,
    request?: DebugProtocol.Request
  ): void {
    logger.info('Exception breakpoints:');
    void this;
    void response;
    void args;
    void request;
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
      this._qmlEngine = new QmlEngine(this);
      this._qmlEngine.server = server;
      this._qmlEngine.start();
      this._qmlEngine.pathMappings = new Map(Object.entries(args.paths));

      this.sendResponse(response);
      this.sendEvent(new InitializedEvent());
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
