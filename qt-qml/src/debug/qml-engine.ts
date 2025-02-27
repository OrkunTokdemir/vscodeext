// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

// import * as vscode from 'vscode';

import {
  QmlDebugClient,
  IQmlDebugClient,
  QmlDebugConnection,
  Server,
  DebugMessageClient,
  IMessageType,
  QmlDebugConnectionState
} from '@debug/debug-connection';
import { Timer } from '@debug/timer';
import { createLogger } from 'qt-lib';
import {
  BreakpointState,
  QmlBreakpoint,
  QmlDebugSession
} from '@debug/debug-adapter';
import {
  BACKTRACE,
  BREAKONSIGNAL,
  COLUMN,
  CONDITION,
  CONNECT,
  CONTINEDEBUGGING,
  DISCONNECT,
  ENABLED,
  EVENT,
  IGNORECOUNT,
  IN,
  INTERRUPT,
  LINE,
  NEXT,
  OUT,
  SCRIPTREGEXP,
  SETBREAKPOINT,
  STEPACTION,
  TARGET,
  TYPE,
  V8DEBUG,
  V8MESSAGE,
  V8REQUEST,
  VERSION
} from '@debug/qmlv8debuggerclientconstants';
import { Packet } from '@debug/packet';
import { DebuggerCommand } from '@debug/debugger-command';
import { isEmpty } from 'lodash';
import { DebugProtocol } from '@vscode/debugprotocol';
import { Source, StackFrame, StoppedEvent } from '@vscode/debugadapter';
import path from 'path';

const logger = createLogger('qml-engine');

export enum DebuggerState {
  DebuggerNotReady, // Debugger not started

  EngineSetupRequested, // Engine starts
  EngineSetupFailed,

  EngineRunRequested,
  EngineRunFailed,

  InferiorUnrunnable, // Used in the core dump adapter

  InferiorRunRequested, // Debuggee requested to run
  InferiorRunOk, // Debuggee running
  InferiorRunFailed, // Debuggee not running

  InferiorStopRequested, // Debuggee running, stop requested
  InferiorStopOk, // Debuggee stopped
  InferiorStopFailed, // Debuggee not stopped, will kill debugger

  InferiorShutdownRequested,
  InferiorShutdownFinished,

  EngineShutdownRequested,
  EngineShutdownFinished,

  DebuggerFinished
}

export enum DebuggerStartMode {
  NoStartMode,
  StartInternal, // Start current start project's binary
  StartExternal, // Start binary found in file system
  AttachToLocalProcess, // Attach to running local process by process id
  AttachToCrashedProcess, // Attach to crashed process by process id
  AttachToCore, // Attach to a core file
  AttachToRemoteServer, // Attach to a running gdbserver
  AttachToRemoteProcess, // Attach to a running remote process
  AttachToQmlServer, // Attach to a running QmlServer
  StartRemoteProcess // Start and attach to a remote process
}

enum QtMsgType {
  QtDebugMsg,
  QtInfoMsg,
  QtWarningMsg,
  QtCriticalMsg,
  QtFatalMsg
}

export enum StepAction {
  Continue,
  StepIn,
  StepOut,
  Next
}

interface IQmlMessage {
  type: string;
  seq: number;
}

interface IQmlResponse extends IQmlMessage {
  request_seq: number;
  command: string;
  success: boolean;
  running: boolean;
  body: IResponseBodySetBreakpoint;
}

interface IQmlEvent extends IQmlMessage {
  event: string;
  body: IResponseBodyBreak;
}

interface IResponseBodySetBreakpoint {
  type: string;
  breakpoint: number;
  line?: number;
  actual_locations?: number[];
}

interface IResponseBodyBreak {
  invocationText: string;
  sourceLineText: string;
  script: IScript;
  breakpoints: number[];
  sourceLine: number;
}

interface IScript {
  name: string;
}

interface QmlMessage {
  type: 'request' | 'event' | 'response';
  seq: number;
}

interface QmlResponse<QmlResponseBody> extends QmlMessage {
  type: 'response';
  request_seq: number;
  command: string;
  success: boolean;
  running: boolean;
  body: QmlResponseBody;
}

interface QmlVariable {
  handle: number;
  name?: string;
  type: string;
  value: unknown;
  ref?: number;
  properties?: QmlVariable[];
}

interface QmlScope {
  frameIndex: number;
  index: number;
  type: number;
  object?: QmlVariable;
}

interface QmlFrame {
  index: number;
  func: string;
  script: string;
  line: number;
  debuggerFrame: boolean;
  scopes: QmlScope[];
}

interface QmlBacktrace {
  fromFrame: number;
  toFrame: number;
  frames: QmlFrame[];
}

export interface QmlContinueResponse extends QmlResponse<undefined> {
  command: 'continue';
}

interface QmlBacktraceResponse extends QmlResponse<QmlBacktrace> {
  command: 'backtrace';
}

export class QmlEngine extends QmlDebugClient implements IQmlDebugClient {
  // override _connection = new QmlDebugConnection();
  // private _previousStepAction = StepAction.Continue;
  private _connectionState = QmlDebugConnectionState.Unavailable;
  private _pathMappings = new Map<string, string>();
  private readonly _callbackForToken = new Map<number, unknown>();
  private readonly _breakpointsSync = new Map<number, QmlBreakpoint>();
  // private readonly __deferredBreakpoints = new Map<number, QmlBreakpoint>();
  private readonly _breakpointsTemp = new Array<string>();
  readonly mainQmlThreadId = 1;
  private _sendBuffer: Packet[] = [];
  private _sequence = -1;
  private readonly _msgClient: DebugMessageClient | undefined;
  private readonly _startMode: DebuggerStartMode =
    DebuggerStartMode.AttachToQmlServer;
  private _server: Server | undefined;
  private _isDying = false;
  // private readonly _breakpointsSync = new Map<number, vscode.Breakpoint>();
  private _state = DebuggerState.DebuggerNotReady;
  // private _dbEngine: DebuggerEngine = new DebuggerEngine();
  private _retryOnConnectFail = false;
  private _automaticConnect = false;
  private readonly _session: QmlDebugSession;
  private readonly _connectionTimer: Timer = new Timer();
  constructor(session: QmlDebugSession) {
    super('V8Debugger', new QmlDebugConnection());
    this._session = session;
    // connect(connection, &QmlDebugConnection::connectionFailed,
    //   this, &QmlEngine::connectionFailed);
    // connect(connection, &QmlDebugConnection::connected,
    //       &d->connectionTimer, &QTimer::stop);
    // connect(connection, &QmlDebugConnection::connected,
    //       this, &QmlEngine::connectionEstablished);
    // connect(connection, &QmlDebugConnection::disconnected,
    //       this, &QmlEngine::disconnected);
    // d->connectionTimer.setInterval(4000);
    // d->connectionTimer.setSingleShot(true);
    // connect(&d->connectionTimer, &QTimer::timeout,
    //         this, &QmlEngine::checkConnectionState);
    this._connectionTimer.setInterval(4000);
    this._connectionTimer.setSingleShot(true);
    this._connectionTimer.onTimeout(() => {
      this.checkConnectionState();
    });
    this.connection.onConnectionFailed(() => {
      this.connectionFailed();
    });
    this.connection.onConnected(() => {
      this._connectionTimer.stop();
      this.connectionEstablished();
    });
    this.connection.onDisconnected(() => {
      this.disconnected();
    });
    this._msgClient = new DebugMessageClient(this.connection);
    this._msgClient.newState((state: QmlDebugConnectionState) => {
      if (!this._msgClient) {
        throw new Error('Message client is not set');
      }
      this.logServiceStateChange(
        this._msgClient.name,
        this._msgClient.serviceVersion(),
        state
      );
    });
    this._msgClient.message((message: IMessageType) => {
      QmlEngine.appendDebugOutput(message);
    });
  }
  get pathMappings() {
    return this._pathMappings;
  }
  set pathMappings(pathMappings: Map<string, string>) {
    this._pathMappings = pathMappings;
  }

  public mapPathFrom(filename: string): string {
    const parsed = path.parse(path.normalize(filename));
    for (const [virtualPath, physicalPath] of this.pathMappings) {
      if (parsed.dir.startsWith(virtualPath)) {
        const relativePath = parsed.dir.slice(
          virtualPath.length,
          parsed.dir.length
        );
        return physicalPath + relativePath + path.sep + parsed.base;
      }
    }
    return filename;
  }
  get connectionState() {
    return this._connectionState;
  }
  override stateChanged(state: QmlDebugConnectionState): void {
    this._connectionState = state;
    // engine->logServiceStateChange(name(), serviceVersion(), state);
    logger.info(
      this.name,
      this.serviceVersion() as unknown as string,
      QmlDebugConnectionState[state]
    );
    if (state === QmlDebugConnectionState.Enabled) {
      // this.claimBreakpointsForEngine();
      const cb = () => {
        void this.flushSendBuffer();
        const jsonParameters = {
          redundantRefs: false,
          namesAsObjects: false
        };
        const msg = new Packet();
        msg.writeJsonUTF8(jsonParameters);
        this.runDirectCommand(CONNECT, msg.data);
        this.runCommand(new DebuggerCommand(VERSION));
      };
      Timer.singleShot(0, cb);
    }
  }
  runCommand(command: DebuggerCommand, cb: unknown = undefined) {
    ++this._sequence;
    const object = {
      type: 'request',
      command: command.function,
      seq: this._sequence,
      arguments: command.args
    };
    if (cb) {
      this._callbackForToken.set(this._sequence, cb);
    }
    const msg = new Packet();
    msg.writeJsonUTF8(object);
    this.runDirectCommand(V8REQUEST, msg.data);
    return this._sequence;
  }
  claimBreakpointsForEngine() {
    void this;
    // for (const [seq, bp] of this.__deferredBreakpoints) {
    //   this.tryClaimBreakpoint(bp);
    //   this.__deferredBreakpoints.delete(seq);
    // }
  }
  tryClaimBreakpoint(bp: QmlBreakpoint) {
    // if (!this.acceptsBreakpoint(bp)) {
    //   return false;
    // }
    return this.requestBreakpointInsertion(bp);
  }
  requestBreakpointInsertion(bp: QmlBreakpoint) {
    return this.insertBreakpoint(bp);
  }
  insertBreakpoint(bp: QmlBreakpoint) {
    const seq = this.setBreakpoint(
      SCRIPTREGEXP,
      bp.filename,
      true,
      bp.line,
      0,
      '',
      0
    );
    if (seq) {
      this._breakpointsSync.set(seq, bp);
    }
    return seq;
  }

  setBreakpoint(
    type: string,
    target: string,
    enabled: boolean,
    line: number,
    column: number,
    condition: string,
    ignoreCount: number
  ) {
    //    { "seq"       : <number>,
    //      "type"      : "request",
    //      "command"   : "setbreakpoint",
    //      "arguments" : { "type"        : <"function" or "script" or "scriptId" or "scriptRegExp">
    //                      "target"      : <function expression or script identification>
    //                      "line"        : <line in script or function>
    //                      "column"      : <character position within the line>
    //                      "enabled"     : <initial enabled state. True or false, default is true>
    //                      "condition"   : <string with break point condition>
    //                      "ignoreCount" : <number specifying the number of break point hits to ignore, default value is 0>
    //                    }
    //    }
    if (type === EVENT) {
      // TODO: Do we need EVENT?
      const rs = new Packet();
      rs.writeStringUTF8(target);
      rs.writeBoolean(enabled);
      this.runDirectCommand(BREAKONSIGNAL, rs.data);
      return undefined;
    } else {
      const cmd = new DebuggerCommand(SETBREAKPOINT);
      cmd.arg(TYPE, type);
      cmd.arg(ENABLED, enabled);
      if (type === SCRIPTREGEXP) {
        // TODO: Use target file instead here
        cmd.arg(TARGET, target);
      } else {
        cmd.arg(TARGET, target);
      }
      if (line) {
        cmd.arg(LINE, line - 1);
      }
      if (column) {
        cmd.arg(COLUMN, column - 1);
      }
      if (!isEmpty(condition)) {
        cmd.arg(CONDITION, condition);
      }
      // if (ignoreCount !== 0) {
      cmd.arg(IGNORECOUNT, ignoreCount);
      // }
      return this.runCommand(cmd);
    }
  }
  async backtrace(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ) {
    //    { "seq"       : <number>,
    //      "type"      : "request",
    //      "command"   : "backtrace",
    //      "arguments" : { "fromFrame" : <number>
    //                      "toFrame" : <number>
    //                      "bottom" : <boolean, set to true if the bottom of the
    //                          stack is requested>
    //                    }
    //    }

    const cmd = new DebuggerCommand(BACKTRACE);
    // wait until the backtrace response is received
    const task = new Promise<unknown>((resolve) => {
      this.runCommand(cmd, (debuggerResponse: unknown) => {
        this.handleBacktrace(debuggerResponse, resolve);
      });
    });
    const result = await task;
    const backtrace = (result as QmlBacktraceResponse).body;
    response.body.totalFrames = backtrace.frames.length;
    let frameCount = 0;
    const stackFrames = backtrace.frames
      .filter((_value, index) => {
        if (args.startFrame !== undefined) {
          if (index < args.startFrame) {
            return false;
          }
        }

        if (args.levels !== undefined) {
          if (frameCount >= args.levels) {
            return false;
          }
          frameCount++;
        }

        return true;
      })
      .map<StackFrame>((frame) => {
        const physicalPath = this.mapPathFrom(frame.script);
        const parsedPath = path.parse(physicalPath);
        return new StackFrame(
          frame.index,
          frame.func,
          new Source(parsedPath.base, physicalPath),
          frame.line + 1
        );
      });
    response.body = {
      stackFrames: stackFrames
    };
    response.success = true;
    // this._session.sendResponse(response);
  }
  handleBacktrace(response: unknown, resolve: (response: unknown) => void) {
    void this;
    const backtrace = response as QmlBacktraceResponse;
    void backtrace;
    resolve(response);
  }
  override messageReceived(packet: Packet): void {
    const command = packet.readStringUTF8();
    if (command !== V8DEBUG) {
      logger.error('Unexpected header:', command);
      return;
    }
    const type = packet.readStringUTF8();
    logger.info('Received message:', type);
    if (type == CONNECT) {
      this.stateChanged(QmlDebugConnectionState.Connected);
      //debugging session started
      logger.info(`${V8DEBUG} debugging session started`);
    } else if (type == INTERRUPT) {
      //debug break requested
      logger.info('Debug break requested');
    } else if (type == BREAKONSIGNAL) {
      //break on signal handler requested
      logger.info('Break on signal handler requested');
    } else if (type == V8MESSAGE) {
      logger.info('V8 message received');
      this.analyzeV8Message(packet);
    }
  }
  async continueDebugging(action: StepAction) {
    //    { "seq"       : <number>,
    //      "type"      : "request",
    //      "command"   : "continue",
    //      "arguments" : { "stepaction" : <"in", "next" or "out">,
    //                      "stepcount"  : <number of steps (default 1)>
    //                    }
    //    }
    const cmd = new DebuggerCommand(CONTINEDEBUGGING);

    if (action === StepAction.StepIn) {
      cmd.arg(STEPACTION, IN);
    } else if (action === StepAction.StepOut) {
      cmd.arg(STEPACTION, OUT);
    } else if (action === StepAction.Next) {
      cmd.arg(STEPACTION, NEXT);
    }

    // this._previousStepAction = action;

    const task = new Promise<unknown>((resolve) => {
      this.runCommand(cmd, (debuggerResponse: unknown) => {
        this.handleContinueDebugging(debuggerResponse, resolve);
        this.notifyInferiorRunOk();
      });
    });
    return task;
  }
  handleContinueDebugging(
    response: unknown,
    resolve: (response: unknown) => void
  ) {
    void this;
    const rsp = response as QmlContinueResponse;
    resolve(rsp);
  }
  analyzeV8Message(packet: Packet) {
    const message = packet.readJsonUTF8() as IQmlMessage;
    const type = message.type;
    if (type === 'response') {
      const response = message as IQmlResponse;
      const debugCommand = response.command;
      const success = response.success;
      if (!success) {
        logger.info('Request was unsuccessful');
      }
      const seq = response.request_seq;
      if (this._callbackForToken.has(seq)) {
        const cb = this._callbackForToken.get(seq);
        this._callbackForToken.delete(seq);
        if (cb) {
          const castedCB = cb as (response: unknown) => void;
          castedCB(response);
        }
      }
      logger.info('Request sequence:', seq as unknown as string);
      if (debugCommand === DISCONNECT) {
        logger.info('Debugging session ended');
        //debugging session ended
      } else if (debugCommand === CONTINEDEBUGGING) {
        logger.info('Continue debugging');
        //do nothing, wait for next break
      } else if (debugCommand === SETBREAKPOINT) {
        //                { "seq"         : <number>,
        //                  "type"        : "response",
        //                  "request_seq" : <number>,
        //                  "command"     : "setbreakpoint",
        //                  "body"        : { "type"       : <"function" or "script">
        //                                    "breakpoint" : <break point number of the new break point>
        //                                  }
        //                  "running"     : <is the VM running after sending this response>
        //                  "success"     : true
        //                }
        const body = response.body;
        const index = body.breakpoint;
        logger.info('Breakpoint index:', index as unknown as string);
        if (this._breakpointsSync.has(seq)) {
          const bp = this._breakpointsSync.get(seq);
          this._breakpointsSync.delete(seq);
          // bp->setParameters(bp->requestedParameters()); // Assume it worked.
          // bp->setResponseId(index);
          const actualLocations = body.actual_locations;
          if (actualLocations) {
            //The breakpoint requested line should be same as actual line
            if (bp && bp.state !== BreakpointState.BreakpointInserted) {
              // bp->setActualLine(actualLocations[0]);
              // bp->setActualColumn(actualLocations[1]);
              logger.info('bp.line:', bp.line.toString());
            }
          }
        } else {
          this._breakpointsTemp.push(seq.toString());
        }
      }
    } else if (type == EVENT) {
      logger.info('Event received');
      const response = message as IQmlEvent;
      const eventType = response.event;
      if (eventType === 'break') {
        //break event
        logger.info('Break event');
        // clearRefs();
        const breakData = response.body;
        const invocationText = breakData.invocationText;
        const scriptUrl = breakData.script.name;
        const sourceLineText = breakData.sourceLineText;
        const v8BreakpointIdList = breakData.breakpoints;
        logger.info('invocationText:', invocationText);
        logger.info('scriptUrl:', scriptUrl);
        logger.info('sourceLineText:', sourceLineText);
        logger.info('v8BreakpointIdList:', v8BreakpointIdList.join(','));
        // const v8Breakpoints: QmlBreakpoint[] = [];
        // v8BreakpointIdList.forEach((v8BreakpointId) => {
        //   const ret = this._breakpointsSync.get(v8BreakpointId);
        //   if (ret) {
        //     v8Breakpoints.push(ret);
        //   }
        // });
        // const inferiorStop = true;
        // if (inferiorStop) {
        if (this.state === DebuggerState.InferiorRunOk) {
          this.notifyInferiorSpontaneousStop(v8BreakpointIdList);
        }
      }
    }
  }
  notifyInferiorRunOk() {
    this.setState(DebuggerState.InferiorRunOk);
  }

  notifyInferiorSpontaneousStop(breakpointIds: number[]) {
    logger.info('NOTE: INFERIOR SPONTANEOUS STOP');
    this.setState(DebuggerState.InferiorStopOk);
    const stoppedEvent: DebugProtocol.StoppedEvent = new StoppedEvent(
      'breakpoint',
      this.mainQmlThreadId
    );
    stoppedEvent.body.hitBreakpointIds = breakpointIds;
    stoppedEvent.body.description = 'Test 1';
    // print stoppedEvent
    logger.info('Stopped event: breakpointIds: ', breakpointIds.join(','));
    this._session.sendEvent(stoppedEvent);
  }
  runDirectCommand(type: string, msg: Buffer) {
    const packet = new Packet();
    packet.writeStringUTF8(V8DEBUG);
    packet.writeStringUTF8(type);
    packet.writeBuffer(msg);
    if (this.getState() === QmlDebugConnectionState.Enabled) {
      void this.sendMessage(packet);
    } else {
      this._sendBuffer.push(packet);
    }
  }
  async flushSendBuffer() {
    if (this.getState() !== QmlDebugConnectionState.Enabled) {
      throw new Error('Connection is not enabled');
    }
    for (const packet of this._sendBuffer) {
      await this.sendMessage(packet);
    }
    this._sendBuffer = [];
  }
  acceptsBreakpoint(bp: QmlBreakpoint) {
    void bp;
    void this;
  }
  logServiceStateChange(
    service: string,
    version: number,
    newState: QmlDebugConnectionState
  ) {
    switch (newState) {
      case QmlDebugConnectionState.Unavailable:
        this.showConnectionStateMessage(
          `Status of "${service}" Version: ${version} changed to 'unavailable'.`
        );
        break;
      case QmlDebugConnectionState.Enabled:
        this.showConnectionStateMessage(
          `Status of "${service}" Version: ${version} changed to 'enabled'.`
        );
        break;
      case QmlDebugConnectionState.NotConnected:
        this.showConnectionStateMessage(
          `Status of "${service}" Version: ${version} changed to 'not connected'.`
        );
        break;
      case QmlDebugConnectionState.Connected:
        this.showConnectionStateMessage(
          `Status of "${service}" Version: ${version} changed to 'connected'.`
        );
        break;
    }
  }

  showConnectionStateMessage(message: string) {
    if (this._isDying) {
      return;
    }
    logger.info('QML Debugger: ' + message);
  }
  static appendDebugOutput(message: IMessageType) {
    switch (message.type as QtMsgType) {
      case QtMsgType.QtInfoMsg:
      case QtMsgType.QtDebugMsg:
        logger.info(message.message);
        break;
      case QtMsgType.QtWarningMsg:
        logger.warn(message.message);
        break;
      case QtMsgType.QtCriticalMsg:
      case QtMsgType.QtFatalMsg:
        logger.error(message.message);
        break;
      default:
        logger.info(message.message);
        break;
    }
    // TODO: Print with logger for now and later use vscode debug console
  }
  checkConnectionState() {
    if (!this.isConnected()) {
      this.closeConnection();
      this.connectionStartupFailed();
    }
  }
  closeConnection() {
    // d->automaticConnect = false;
    // d->retryOnConnectFail = false;
    // d->connectionTimer.stop();
    // if (QmlDebugConnection *connection = d->connection())
    //     connection->close();
    this._automaticConnect = false;
    this._retryOnConnectFail = false;
    this._connectionTimer.stop();
    this.connection.close();
  }
  connectionEstablished() {
    if (this.state == DebuggerState.EngineRunRequested) {
      this.notifyEngineRunAndInferiorRunOk();
    }
  }
  notifyEngineRunAndInferiorRunOk() {
    logger.info('NOTE: ENGINE RUN AND INFERIOR RUN OK');
    this.setState(DebuggerState.InferiorRunOk);
  }
  disconnected() {
    if (this._isDying) {
      return;
    }
    // showMessage(Tr::tr("QML Debugger disconnected."), StatusBar);
    logger.info('QML Debugger disconnected.');
    this.notifyInferiorExited();
  }
  notifyInferiorExited() {
    // showMessage("NOTE: INFERIOR EXITED");
    // d->resetLocation();
    // setState(InferiorShutdownFinished);
    // d->doShutdownEngine();
    logger.info('NOTE: INFERIOR EXITED');
    this.setState(DebuggerState.InferiorShutdownFinished);
    this.doShutdownEngine();
  }
  connectionFailed() {
    // // this is only an error if we are already connected and something goes wrong.
    // if (isConnected()) {
    //   showMessage(Tr::tr("QML Debugger: Connection failed."), StatusBar);
    //   notifyInferiorSpontaneousStop();
    //   notifyInferiorIll();
    // } else {
    //     d->connectionTimer.stop();
    //     connectionStartupFailed();
    // }
    if (this.isConnected()) {
      logger.error('QML Debugger: Connection failed.');
      // notifyInferiorSpontaneousStop();
      // notifyInferiorIll();
    } else {
      this._connectionTimer.stop();
      this.connectionStartupFailed();
    }
  }
  connectionStartupFailed() {
    if (this._isDying) {
      return;
    }
    if (this._retryOnConnectFail) {
      // retry after 3 seconds ...
      // QTimer::singleShot(3000, this, [this] { beginConnection(); });
      Timer.singleShot(3000, () => {
        logger.info('Retrying connection ...');
        this.beginConnection();
      });
      return;
    }
    logger.error('Could not connect to the in-process QML debugger.');
    // Do you want to retry?
    // TODO: Show user an info message
  }
  isConnected() {
    return this.connection.isConnected();
  }
  set server(server: Server | undefined) {
    this._server = server;
  }
  get server() {
    return this._server;
  }
  setupEngine() {
    this.notifyEngineSetupOk();

    // TODO: Need this?
    // // we won't get any debug output
    // if (!usesTerminal()) {
    //   d->retryOnConnectFail = true;
    //   d->automaticConnect = true;
    // }
    if (this.state !== DebuggerState.EngineRunRequested) {
      throw new Error('Unexpected state:' + this.state);
    }
    if (this._startMode === DebuggerStartMode.AttachToQmlServer) {
      this.tryToConnect();
    }
    if (this._automaticConnect) {
      this.beginConnection();
    }
  }
  start() {
    // d->m_watchHandler.resetWatchers();
    // d->setInitialActionStates();
    this.setState(DebuggerState.EngineSetupRequested);
    logger.info('CALL: SETUP ENGINE');
    this.setupEngine();
  }
  tryToConnect() {
    logger.info('QML Debugger: Trying to connect ...');
    this._retryOnConnectFail = true;

    if (this.state === DebuggerState.EngineRunRequested) {
      if (this._isDying) {
        // Probably cpp is being debugged and hence we did not get the output yet.
        this.appStartupFailed('No application output received in time');
      } else {
        this.beginConnection();
      }
    } else {
      this._automaticConnect = true;
    }
  }
  beginConnection() {
    if (
      this.state !== DebuggerState.EngineRunRequested &&
      this._retryOnConnectFail
    ) {
      return;
    }
    if (this.server === undefined) {
      throw new Error('Server is not set');
    }
    let host = this.server.host;
    if (host === '') {
      host = 'localhost';
    }
    const port = this.server.port;
    const connection = this.connection;
    if (connection.isConnected()) {
      return;
    }
    connection.connectToHost(host, port);
    this._connectionTimer.start();
  }
  appStartupFailed(errorMessage: string) {
    logger.error(
      'Could not connect to the in-process QML debugger. ' + errorMessage
    );
    // TODO: Show user an info message
    this.notifyEngineRunFailed();
  }
  notifyEngineRunFailed() {
    logger.info('NOTE: ENGINE RUN FAILED');
    this.setState(DebuggerState.EngineRunFailed);
    this.doShutdownEngine();
  }
  doShutdownEngine() {
    this.setState(DebuggerState.EngineShutdownRequested);
    this.startDying();
    logger.info('CALL: SHUTDOWN ENGINE');
    this.shutdownEngine();
  }
  startDying() {
    this._isDying = true;
  }
  shutdownEngine() {
    //   clearExceptionSelection();

    //   debuggerConsole()->setScriptEvaluator(ScriptEvaluator());

    //  // double check (ill engine?):
    //   stopProcess();
    this.notifyEngineShutdownFinished();
  }
  notifyEngineShutdownFinished() {
    // showMessage("NOTE: ENGINE SHUTDOWN FINISHED");
    // QTC_ASSERT(state() == EngineShutdownRequested, qDebug() << this << state());
    // setState(EngineShutdownFinished);
    // d->doFinishDebugger();
    logger.info('NOTE: ENGINE SHUTDOWN FINISHED');
    this.setState(DebuggerState.EngineShutdownFinished);
    this.doFinishDebugger();
  }
  doFinishDebugger() {
    // TODO: Nees the below code?
    // QTC_ASSERT(m_state == EngineShutdownFinished, qDebug() << m_state);
    // resetLocation();
    // m_progress.setProgressValue(1000);
    // m_progress.reportFinished();
    // m_modulesHandler.removeAll();
    // m_stackHandler.removeAll();
    // m_threadsHandler.removeAll();
    // m_watchHandler.cleanup();
    // m_engine->showMessage(Tr::tr("Debugger finished."), StatusBar);
    // m_engine->setState(DebuggerFinished); // Also destroys views.
    // if (settings().switchModeOnExit())
    //     EngineManager::deactivateDebugMode();
    this.setState(DebuggerState.DebuggerFinished);
  }
  notifyEngineSetupOk() {
    logger.info('NOTE: ENGINE SETUP OK');

    if (this.state !== DebuggerState.EngineSetupRequested) {
      throw new Error('Unexpected state:' + this.state);
    }
    this.setState(DebuggerState.EngineRunRequested);
  }

  get state() {
    return this._state;
  }
  setState(state: DebuggerState) {
    this._state = state;
  }
}
