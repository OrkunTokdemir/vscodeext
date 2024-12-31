// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import {QmlDebugClient, IQmlDebugClient, QmlDebugConnection } from '@debug/debug-connection';
import { Timer } from '@debug/timer';
import { DebuggerEngine } from '@debug/debugger-engine';

enum DebuggerState
{
    DebuggerNotReady,          // Debugger not started

    EngineSetupRequested,      // Engine starts
    EngineSetupFailed,

    EngineRunRequested,
    EngineRunFailed,

    InferiorUnrunnable,        // Used in the core dump adapter

    InferiorRunRequested,      // Debuggee requested to run
    InferiorRunOk,             // Debuggee running
    InferiorRunFailed,         // Debuggee not running

    InferiorStopRequested,     // Debuggee running, stop requested
    InferiorStopOk,            // Debuggee stopped
    InferiorStopFailed,        // Debuggee not stopped, will kill debugger

    InferiorShutdownRequested,
    InferiorShutdownFinished,

    EngineShutdownRequested,
    EngineShutdownFinished,

    DebuggerFinished
}
export class QmlEngine extends QmlDebugClient implements IQmlDebugClient {
//   override _connection = new QmlDebugConnection();
  private readonly _breakpointsSync = new Map<number, vscode.Breakpoint>();
  private readonly _breakpointsTemp = new Array<string>();
  private _state: DebuggerState = DebuggerState.DebuggerNotReady;
  private _dbEngine: DebuggerEngine = new DebuggerEngine();
  private readonly _timer: Timer = new Timer();
  constructor() {
    super("V8Debugger", new QmlDebugConnection());
    console.log('QmlEngine');
  }
  setupEngine() {
  }
  notifyEngineSetupOk() {
    
  }
}
