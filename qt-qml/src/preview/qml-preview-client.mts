// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import {
  QmlDebugClient,
  IQmlDebugClient,
  QmlDebugConnection,
  QmlDebugConnectionState
} from '@debug/debug-connection.mjs';
import { Packet } from '@debug/packet.mjs';
import { createLogger } from 'qt-lib';

const logger = createLogger('qml-preview-client');

enum QmlPreviewCommand {
  File,
  Load,
  Request,
  Error,
  Rerun,
  Directory,
  ClearCache,
  Zoom,
  Fps
}

export interface FpsInfo {
  numSyncs: number;
  minSync: number;
  maxSync: number;
  totalSync: number;
  numRenders: number;
  minRender: number;
  maxRender: number;
  totalRender: number;
}

export class QmlPreviewClient
  extends QmlDebugClient
  implements IQmlDebugClient
{
  private readonly _pathRequested = new vscode.EventEmitter<string>();
  private readonly _errorReported = new vscode.EventEmitter<string>();
  private readonly _fpsReported = new vscode.EventEmitter<FpsInfo>();
  private readonly _debugServiceUnavailable = new vscode.EventEmitter<void>();

  constructor(connection: QmlDebugConnection) {
    super('QmlPreview', connection);
  }

  get onPathRequested() {
    return this._pathRequested.event;
  }

  get onErrorReported() {
    return this._errorReported.event;
  }

  get onFpsReported() {
    return this._fpsReported.event;
  }

  get onDebugServiceUnavailable() {
    return this._debugServiceUnavailable.event;
  }

  loadUrl(url: URL) {
    const packet = new Packet();
    packet.writeInt8(QmlPreviewCommand.Load);
    packet.writeStringUTF16(url.toString());
    void this.sendMessage(packet);
  }

  rerun() {
    const packet = new Packet();
    packet.writeInt8(QmlPreviewCommand.Rerun);
    void this.sendMessage(packet);
  }

  zoom(zoomFactor: number) {
    const packet = new Packet();
    packet.writeInt8(QmlPreviewCommand.Zoom);
    packet.writeFloatBE(zoomFactor);
    void this.sendMessage(packet);
  }

  announceFile(path: string, contents: Buffer) {
    const packet = new Packet();
    packet.writeInt8(QmlPreviewCommand.File);
    packet.writeStringUTF16(path);
    packet.writeUInt32BE(contents.length);
    packet.writeBuffer(contents);
    void this.sendMessage(packet);
  }

  announceDirectory(path: string, entries: string[]) {
    const packet = new Packet();
    packet.writeInt8(QmlPreviewCommand.Directory);
    packet.writeStringUTF16(path);
    packet.writeArray(entries, (entry) => {
      packet.writeStringUTF16(entry);
    });
    void this.sendMessage(packet);
  }

  announceError(path: string) {
    const packet = new Packet();
    packet.writeInt8(QmlPreviewCommand.Error);
    packet.writeStringUTF16(path);
    void this.sendMessage(packet);
  }

  clearCache() {
    const packet = new Packet();
    packet.writeInt8(QmlPreviewCommand.ClearCache);
    void this.sendMessage(packet);
  }

  override messageReceived(packet: Packet): void {
    const command = packet.readInt8() as QmlPreviewCommand;

    switch (command) {
      case QmlPreviewCommand.Request: {
        const path = packet.readStringUTF16LE();
        this._pathRequested.fire(path);
        break;
      }
      case QmlPreviewCommand.Error: {
        const error = packet.readStringUTF16LE();
        this._errorReported.fire(error);
        break;
      }
      case QmlPreviewCommand.Fps: {
        const info: FpsInfo = {
          numSyncs: packet.readInt16BE(),
          minSync: packet.readInt16BE(),
          maxSync: packet.readInt16BE(),
          totalSync: packet.readInt16BE(),
          numRenders: packet.readInt16BE(),
          minRender: packet.readInt16BE(),
          maxRender: packet.readInt16BE(),
          totalRender: packet.readInt16BE()
        };
        this._fpsReported.fire(info);
        break;
      }
      default:
        logger.warn('Unknown preview command:', QmlPreviewCommand[command]);
        break;
    }
  }

  override stateChanged(state: QmlDebugConnectionState): void {
    logger.info('QmlPreview state changed:', QmlDebugConnectionState[state]);
    if (state === QmlDebugConnectionState.Unavailable) {
      this._debugServiceUnavailable.fire();
    }
  }

  dispose() {
    this._pathRequested.dispose();
    this._errorReported.dispose();
    this._fpsReported.dispose();
    this._debugServiceUnavailable.dispose();
  }
}
