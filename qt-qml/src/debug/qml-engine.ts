// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

// import * as vscode from 'vscode';

import {
  QmlDebugClient,
  IQmlDebugClient,
  QmlDebugConnection,
  Server
} from '@debug/debug-connection';
import { Timer } from '@debug/timer';
// import { DebuggerEngine } from '@debug/debugger-engine';
import { createLogger } from 'qt-lib';

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

export class QmlEngine extends QmlDebugClient implements IQmlDebugClient {
  //   override _connection = new QmlDebugConnection();
  private readonly _startMode: DebuggerStartMode =
    DebuggerStartMode.AttachToQmlServer;
  private _server: Server | undefined;
  private _isDying = false;
  // private readonly _breakpointsSync = new Map<number, vscode.Breakpoint>();
  // private readonly _breakpointsTemp = new Array<string>();
  private _state: DebuggerState = DebuggerState.DebuggerNotReady;
  // private _dbEngine: DebuggerEngine = new DebuggerEngine();
  private _retryOnConnectFail = true;
  private _automaticConnect = true;
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
    if (this.state !== DebuggerState.EngineSetupRequested) {
      throw new Error('Unexpected state:' + this.state);
    }
    if (this._startMode === DebuggerStartMode.AttachToQmlServer) {
      this.tryToConnect();
    }
    if (this._automaticConnect) {
      this.beginConnection();
    }
  }
  tryToConnect() {
    logger.info('QML Debugger: Trying to connect ...');
    this._retryOnConnectFail = true;

    if (this.state === DebuggerState.EngineSetupRequested) {
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
      this.state != DebuggerState.EngineRunRequested &&
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
  }

  get state() {
    return this._state;
  }
  setState(state: DebuggerState) {
    this._state = state;
  }
}
