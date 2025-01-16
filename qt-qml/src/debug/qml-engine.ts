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
// import { DebuggerEngine } from '@debug/debugger-engine';
import { createLogger } from 'qt-lib';
import { QmlBreakpoint } from '@debug/debug-adapter';
import {
  BREAKONSIGNAL,
  COLUMN,
  CONDITION,
  CONNECT,
  ENABLED,
  EVENT,
  IGNORECOUNT,
  INTERRUPT,
  LINE,
  SCRIPTREGEXP,
  SETBREAKPOINT,
  TARGET,
  TYPE,
  V8DEBUG,
  V8MESSAGE,
  V8REQUEST,
  VERSION
} from '@debug/qmlv8debuggerclientconstants';
import { Packet } from '@debug/packet';
import { DebuggerCommand } from '@debug/debugger-command';

const logger = createLogger('qml-engine');

enum DebuggerState {
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

interface IQmlMessage {
  type: string;
  seq: number;
}

interface IQmlResponse extends IQmlMessage {
  request_seq: number;
  command: string;
  success: boolean;
  running: boolean;
}

export class QmlEngine extends QmlDebugClient implements IQmlDebugClient {
  //   override _connection = new QmlDebugConnection();
  private _sendBuffer: Packet[] = [];
  private _sequence = -1;
  private readonly _msgClient: DebugMessageClient | undefined;
  private readonly _startMode: DebuggerStartMode =
    DebuggerStartMode.AttachToQmlServer;
  private _server: Server | undefined;
  private _isDying = false;
  // private readonly _breakpointsSync = new Map<number, vscode.Breakpoint>();
  // private readonly _breakpointsTemp = new Array<string>();
  private _state = DebuggerState.DebuggerNotReady;
  // private _dbEngine: DebuggerEngine = new DebuggerEngine();
  private _retryOnConnectFail = false;
  private _automaticConnect = false;
  private readonly _connectionTimer: Timer = new Timer();
  constructor() {
    super('V8Debugger', new QmlDebugConnection());
    console.log('QmlEngine');
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
  override stateChanged(state: QmlDebugConnectionState): void {
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
  runCommand(command: DebuggerCommand) {
    const object = {
      type: 'request',
      command: command.function,
      seq: ++this._sequence,
      arguments: command.args
    };
    const msg = new Packet();
    msg.writeJsonUTF8(object);
    this.runDirectCommand(V8REQUEST, msg.data);
  }
  claimBreakpointsForEngine() {
    void this;
  }
  tryClaimBreakpoint(bp: QmlBreakpoint) {
    // if (!this.acceptsBreakpoint(bp)) {
    //   return false;
    // }
    this.requestBreakpointInsertion(bp);
  }
  requestBreakpointInsertion(bp: QmlBreakpoint) {
    this.insertBreakpoint(bp);
  }
  insertBreakpoint(bp: QmlBreakpoint) {
    this.setBreakpoint(SCRIPTREGEXP, bp.filename, true, bp.line, 0, '', -1);
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
    void line;
    void column;
    void condition;
    void ignoreCount;

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
      const rs = new Packet();
      rs.writeStringUTF8(target);
      rs.writeBoolean(enabled);
      this.runDirectCommand(BREAKONSIGNAL, rs.data);
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
      if (condition) {
        cmd.arg(CONDITION, condition);
      }
      if (ignoreCount !== -1) {
        cmd.arg(IGNORECOUNT, ignoreCount);
      }
      this.runCommand(cmd);
    }
  }
  override messageReceived(packet: Packet): void {
    void this;
    void packet;
    const command = packet.readStringUTF8();
    if (command !== V8DEBUG) {
      logger.error('Unexpected header:', command);
      return;
    }
    const type = packet.readStringUTF8();
    logger.info('Received message:', type);
    if (type == CONNECT) {
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
    }
    const message = packet.readJsonUTF8() as IQmlMessage;
    if (message.type === 'response') {
      const response = message as IQmlResponse;
      const debugCommand = response.command;
      void debugCommand;
      const success = response.success;
      if (!success) {
        logger.info('Request was unsuccessful');
      }
      const requestSeq = response.request_seq;
      logger.info('Request sequence:', requestSeq as unknown as string);
    }
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
