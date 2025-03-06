// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { createLogger, delay, getFilename } from 'qt-lib';
import {
  QmlDebugConnectionState,
  // DebugMessageClient,
  // QmlDebugConnectionManager,
  Server,
  ServerScheme
} from '@debug/debug-connection';
import {
  InitializedEvent,
  LoggingDebugSession,
  TerminatedEvent,
  Thread
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { QmlContinueResponse, QmlEngine, StepAction } from '@debug/qml-engine';

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
  private readonly _breakpoints = new Map<string, QmlBreakpoint[]>();
  public constructor(session: vscode.DebugSession) {
    super();

    logger.info('Creating debug session for session:', session.id);
  }
  findBreakpoint(filename: string, line: number): QmlBreakpoint | undefined {
    const breakpoints = this._breakpoints.get(filename);
    if (!breakpoints) {
      return undefined;
    }
    for (const breakpoint of breakpoints) {
      if (breakpoint.line === line) {
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
    try {
      logger.info('Func: setBreakPointsRequest: Begin');
      void request;
      if (this._qmlEngine === undefined) {
        throw new Error('QmlEngine not initialized');
      }
      if (!args.source.path) {
        throw new Error('Source path is not defined');
      }
      const breakpointstoRemove: QmlBreakpoint[] = [];
      const breakpointsToAdd: QmlBreakpoint[] = [];
      const sourceBreakpoints = args.breakpoints ?? [];
      // check if current breakpoints are the same as the new ones
      for (const sourceBreakpoint of sourceBreakpoints) {
        const found = this.findBreakpoint(
          args.source.path,
          sourceBreakpoint.line
        );
        if (!found) {
          const newBreakpoint: QmlBreakpoint = {
            filename: getFilename(args.source.path),
            line: sourceBreakpoint.line,
            state: BreakpointState.BreakpointNew
          };
          const currentSourceBreakpoints = this._breakpoints.get(
            args.source.path
          );
          if (currentSourceBreakpoints) {
            currentSourceBreakpoints.push(newBreakpoint);
          } else {
            this._breakpoints.set(args.source.path, [newBreakpoint]);
          }
          breakpointsToAdd.push(newBreakpoint);
        }
      }
      for (const breakpoint of this._breakpoints.get(args.source.path) ?? []) {
        const found = sourceBreakpoints.find(
          (sourceBreakpoint) => sourceBreakpoint.line === breakpoint.line
        );
        if (!found) {
          breakpointstoRemove.push(breakpoint);
        }
      }

      // wait until debugger is ready
      while (
        this._qmlEngine.connectionState !== QmlDebugConnectionState.Connected
      ) {
        await delay(1000);
      }

      for (const breakpoint of breakpointstoRemove) {
        const breakpoints = this._breakpoints.get(args.source.path);
        if (!breakpoints) {
          continue;
        }
        const index = breakpoints.indexOf(breakpoint);
        breakpoints.splice(index, 1);
        this._qmlEngine.clearBreakpoint(breakpoint);
      }
      for (const breakpoint of breakpointsToAdd) {
        const breakpontId =
          await this._qmlEngine.tryClaimBreakpoint(breakpoint);
        if (breakpontId) {
          breakpoint.id = breakpontId;
        }
      }

      response.body = {
        breakpoints: []
      };
      const currentBreakpoints = this._breakpoints.get(args.source.path);
      if (currentBreakpoints) {
        const sortedCurrentBreakpoints = currentBreakpoints.sort(
          (a, b) => a.line - b.line
        );
        for (const breakpoint of sortedCurrentBreakpoints) {
          if (breakpoint.id === undefined) {
            throw new Error('Breakpoint id is undefined');
          }
          response.body.breakpoints.push({
            id: breakpoint.id,
            line: breakpoint.line,
            verified: true
          });
        }
      }
      logger.info('setBreakPointsRequest response:', JSON.stringify(response));
      this.sendResponse(response);
    } catch (err) {
      this.sendError(response, 1, err as string);
    }
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
    void request;
    try {
      if (!this._qmlEngine) {
        throw new Error('QmlEngine not initialized');
      }
      logger.info('stackTraceRequest:', JSON.stringify(args));
      response.body = {
        stackFrames: []
      };
      await this._qmlEngine.backtrace(response, args);
      this.sendResponse(response);
    } catch (err) {
      this.sendError(response, 1, err as string);
    }
  }
  protected override async continueRequest(
    response: DebugProtocol.ContinueResponse,
    args: DebugProtocol.ContinueArguments,
    request?: DebugProtocol.Request
  ) {
    try {
      if (!this._qmlEngine) {
        throw new Error('QmlEngine not initialized');
      }
      void request;
      void args;
      const result = (await this._qmlEngine.continueDebugging(
        StepAction.Continue
      )) as QmlContinueResponse;
      if (!result.success) {
        response.success = false;
      }
      this.sendResponse(response);
    } catch (err) {
      this.sendError(response, 1, err as string);
    }
  }
  protected override async stepInRequest(
    response: DebugProtocol.StepInResponse,
    args: DebugProtocol.StepInArguments,
    request?: DebugProtocol.Request
  ) {
    try {
      if (!this._qmlEngine) {
        throw new Error('QmlEngine not initialized');
      }
      void request;
      void args;
      const result = (await this._qmlEngine.continueDebugging(
        StepAction.StepIn
      )) as QmlContinueResponse;
      if (!result.success) {
        response.success = false;
      }
      this.sendResponse(response);
    } catch (err) {
      this.sendError(response, 1, err as string);
    }
  }
  protected override async stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    args: DebugProtocol.StepOutArguments,
    request?: DebugProtocol.Request
  ) {
    try {
      if (!this._qmlEngine) {
        throw new Error('QmlEngine not initialized');
      }
      void request;
      void args;
      const result = (await this._qmlEngine.continueDebugging(
        StepAction.StepOut
      )) as QmlContinueResponse;
      if (!result.success) {
        response.success = false;
      }
      this.sendResponse(response);
    } catch (err) {
      this.sendError(response, 1, err as string);
    }
  }
  protected override async nextRequest(
    response: DebugProtocol.NextResponse,
    args: DebugProtocol.NextArguments,
    request?: DebugProtocol.Request
  ) {
    try {
      if (!this._qmlEngine) {
        throw new Error('QmlEngine not initialized');
      }
      void request;
      void args;
      const result = (await this._qmlEngine.continueDebugging(
        StepAction.Next
      )) as QmlContinueResponse;
      if (!result.success) {
        response.success = false;
      }
      this.sendResponse(response);
    } catch (err) {
      this.sendError(response, 1, err as string);
    }
  }
  private sendError(
    response: DebugProtocol.Response,
    number: number,
    err: string
  ) {
    this.sendErrorResponse(response, {
      id: number,
      format: 'QML Debug: ' + err,
      showUser: true
    });
    this.sendEvent(new TerminatedEvent());
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
    } catch (err) {
      this.sendError(response, 1, err as string);
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
