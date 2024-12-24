// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

export class Timer {
  private readonly _onTimeout: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  private _interval: number | undefined; // ms
  private _timer: NodeJS.Timeout | undefined;
  constructor(interval?: number) {
    this._interval = interval;
  }
  get onTimeout() {
    return this._onTimeout.event;
  }
  dispose() {
    this.disconnect();
    this.stop();
  }
  disconnect() {
    this._onTimeout.dispose();
  }

  isActive() {
    return this._timer ? true : false;
  }

  start(interval?: number) {
    if (interval) {
      this._interval = interval;
    }
    this._timer = setInterval(() => {
      this._onTimeout.fire();
    }, this._interval);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = undefined;
  }
}
