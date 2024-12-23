// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { DataStream } from '@debug/datastream';
import { PromiseSocket } from 'promise-socket';
import { Socket } from 'net';

type PacketSocket = PromiseSocket<Socket>;

export class Packet extends DataStream {
  override get data() {
    return super.data;
  }
}

export class PacketProtocol {
  private readonly socket: PacketSocket;
  private readonly _readyRead = new vscode.EventEmitter<void>();
  private readonly _protocolError = new vscode.EventEmitter<void>();
  constructor(socket: Socket) {
    this.socket = new PromiseSocket(socket);
  }
  disconnect() {
    this._readyRead.dispose();
    this._protocolError.dispose();
  }
  readyRead() {
    this._readyRead.fire();
  }
  get onReadyRead() {
    return this._readyRead.event;
  }
  async send(buffer: Buffer) {
    // return if the size is more than max int32 - 4
    const maxSendSize = 0x7fffffff - 4;
    if (buffer.length > maxSendSize) {
      throw new Error('Packet is too large');
    }
    if (this.socket.socket.destroyed) {
      return;
    }
    if (buffer.length === 0) {
      return; // We don't send empty packets
    }
    const sendSize = buffer.length + 4;
    const sendSizeLE = to32LE(sendSize);
    await this.waitUntilWritten(sendSizeLE);
    await this.waitUntilWritten(buffer);
  }
  private async waitUntilWritten(buffer: Buffer) {
    let written = 0;
    while (written < buffer.length) {
      written = await this.socket.write(buffer);
      buffer = buffer.subarray(written);
    }
  }
}

function to32LE(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
}
