// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { Packet, PacketProtocol } from '@debug/packet';
import { Socket } from 'net';
import { createLogger } from 'qt-lib';

const logger = createLogger('project');

export enum ServerScheme {
  Tcp = 'tcp',
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Socket = 'unix'
}

export interface Server {
  host: string;
  port: number;
  scheme: ServerScheme;
}

const serverId = 'QDeclarativeDebugServer';
// const clientId = "QDeclarativeDebugClient";

export class QmlDebugConnectionManager {
  private _server: Server | undefined;
  private _connection: QmlDebugConnection | undefined;
  private _retryInterval = 200;
  private _maximumRetries = 10;
  private readonly _connectionOpened = new vscode.EventEmitter<void>();
  private readonly _connectionClosed = new vscode.EventEmitter<void>();
  private readonly _connectionFailed = new vscode.EventEmitter<void>();
  // private readonly _numRetries = 0;

  // constructor(server: Server) {
  //     this._server = server;
  // }
  get retryInterval() {
    return this._retryInterval;
  }
  set retryInterval(value: number) {
    this._retryInterval = value;
  }
  set maximumRetries(value: number) {
    this._maximumRetries = value;
  }
  get maximumRetries() {
    return this._maximumRetries;
  }
  dispose() {
    if (this._connection) {
      this._connection.dispose();
    }
  }
  disconnectToConnection() {
    if (this._connection) {
      this._connection.disconnect();
    }
  }
  isConnected() {
    if (!this._connection) {
      return false;
    }
    return this._connection.isConnected();
  }

  connectToServer(server: Server) {
    if (this._server !== server) {
      this._server = server;
      // destroyConnection(); // TODO: Implement
      // stopConnectionTimer(); // TODO: Implement
    }
    if (this._server.scheme === ServerScheme.Tcp) {
      this.connectToTcpServer();
    } else {
      // this.connectToSocketServer();
      throw new Error('Not implemented');
    }
  }
  connectToTcpServer() {
    if (!this._server) {
      throw new Error('Server not set');
    }
    if (!this._connection) {
      this.createConnection();
    }
    if (this._connection) {
      this._connection.connectToHost(this._server.host, this._server.port);
    }
  }
  createConnection() {
    this._connection = new QmlDebugConnection();
    this.createClients();
    this.connectConnectionSignals();
  }
  createClients() {
    void this;
  }
  connectConnectionSignals() {
    if (!this._connection) {
      throw new Error('Connection not set');
    }
    this._connection.onConnected(() => {
      this.qmlDebugConnectionOpened();
    });
    this._connection.onDisconnected(() => {
      this.qmlDebugConnectionClosed();
    });
  }
  qmlDebugConnectionOpened() {
    if (this._connection?.isConnected()) {
      return;
    }
    logger.info('Connection opened');
    // stopConnectionTimer();
    // emit connectionOpened();
    this._connectionOpened.fire();
  }
  qmlDebugConnectionClosed() {
    if (!this._connection?.isConnected()) {
      return;
    }
    logger.info('Connection closed');
    // this.destroyConnection(); // TODO: Implement
    this._connectionClosed.fire();
  }
  qmlDebugConnectionFailed() {
    if (this._connection) {
      return;
    }
    logger.error('Connection failed');
    this._connectionFailed.fire();
  }

  // isConnecting() {
  //     // TODO: Implement
  // }
  // isConnected() {
  //     // TODO: Implement
  // }
}

export class QmlDebugConnection {
  private _device: Socket | undefined;
  private _protocol: PacketProtocol | undefined;
  private static readonly minStreamVersion = 12;
  // private static readonly maxStreamVersion = 23;
  private readonly _connected = new vscode.EventEmitter<void>();
  private readonly _disconnected = new vscode.EventEmitter<void>();
  private readonly _connectionFailed = new vscode.EventEmitter<void>();
  private _gotHello = false;
  private readonly _plugins = new Map<string, QmlDebugClient>();
  get gotHello() {
    return this._gotHello;
  }
  // Destroy event emitters
  // QObject -> disconnect
  disconnect() {
    this._disconnected.dispose();
    this._connectionFailed.dispose();
  }
  get onConnected() {
    return this._connected.event;
  }
  get onDisconnected() {
    return this._disconnected.event;
  }
  get onConnectionFailed() {
    return this._connectionFailed.event;
  }

  socketDisconnected() {
    if (this.gotHello) {
      this._gotHello = false;
      for (const p of this._plugins.values()) {
        p.stateChanged(QmlDebugConnectionState.Unavailable);
      }
      this._disconnected.fire();
    } else if (this._device) {
      this._connectionFailed.fire();
    }

    if (this._protocol) {
      this._protocol.disconnect();
      // d->protocol->deleteLater(); // Do we need this?
      this._protocol = undefined;
    }
    if (this._device) {
      // Don't allow any "connected()" or "disconnected()" signals to be triggered anymore.
      // As the protocol is gone this would lead to crashes.
      // d->device->disconnect();
      this._device.destroy();
      // Don't immediately delete it as it may do some cleanup on returning from a signal.
      // d->device->deleteLater();
      this._device = undefined;
    }
  }
  // connectToHost(host: string, port: number) {
  //     // TODO: Implement
  // }
  // isConnected() {
  //     // TODO: Implement
  // }
  // isConnecting() {
  //     // TODO: Implement
  // }
  close() {
    if (this._device && this._device.readyState === 'open') {
      this._device.destroy();
    }
  }
  dispose() {
    this.socketDisconnected();
    this.disconnect();
  }
  isConnected() {
    return this.gotHello;
  }
  isConnecting() {
    return !this.gotHello && this._device;
  }
  // close() {
  //     if (this._device) {
  //         this._device.destroy();
  //     }
  // }
  connectToHost(host: string | undefined, port: number) {
    this.socketDisconnected();
    this._device = new Socket();
    this._protocol = new PacketProtocol(this._device);
    this._protocol.onReadyRead(() => {
      this.protocolReadyRead();
    });
    // Need this?
    // connect(socket, &QAbstractSocket::stateChanged,
    //     this, [this](QAbstractSocket::SocketState state) {
    // emit logStateChange(socketStateToString(state));
    this._device.on('error', (error: Error) => {
      logger.error(`Error connecting to host: ${error.message}`);
      this.socketDisconnected();
    });
    this._device.on('connect', () => {
      logger.info('Connected to host');
      void this.socketConnected();
    });
    this._device.on('data', () => {
      if (!this._protocol) {
        throw new Error('Protocol not set');
      }
      logger.info('Data received');
      this._protocol.readyRead();
    });
    this._device.on('close', () => {
      logger.info('Socket closed');
      this.socketDisconnected();
    });
    this._device.connect(port, host ? host : 'localhost');
  }
  async socketConnected() {
    const packet = new Packet();
    packet.writeStringUTF16(serverId);
    packet.writeInt32BE(0); // OP
    packet.writeInt32BE(1); // Version
    // const plugins = Array.from(this._plugins.keys());
    // for (const plugin of plugins) {
    //   packet.writeStringUTF16(plugin);
    // }
    packet.writeStringUTF16('QmlDebugger');
    packet.writeInt32BE(QmlDebugConnection.minStreamVersion);
    packet.writeBoolean(true);
    if (!this._protocol) {
      throw new Error('Protocol not set');
    }
    await this._protocol.send(packet.data);
  }
  protocolReadyRead() {
    void this;
    // TODO: Implement
  }
  // sendMessage(name: string, buffer: Buffer) {
  //     if (!this.gotHello || !this._plugins.has(name)) {
  //         return false;
  //     }
  //     const packet = new Packet();
  //     packet.writeStringUTF16(name);
  //     // packet.writeInt32BE(buffer.length);
  // }
  async addClient(name: string, client: QmlDebugClient) {
    if (this._plugins.has(name)) {
      return false;
    }
    this._plugins.set(name, client);
    await this.advertisePlugins();
    return true;
  }
  async removeClient(name: string) {
    if (!this._plugins.has(name)) {
      return false;
    }
    this._plugins.delete(name);
    await this.advertisePlugins();
    return true;
  }
  async advertisePlugins() {
    if (!this.gotHello) {
      return;
    }
    const packet = new Packet();
    packet.writeStringUTF16(serverId);
    // packet.writeInt32BE(0); // OP
    packet.writeInt32BE(1); // Version
    const plugins = Array.from(this._plugins.keys());
    for (const plugin of plugins) {
      packet.writeStringUTF16(plugin);
    }
    packet.writeInt32BE(QmlDebugConnection.minStreamVersion);
    packet.writeBoolean(true);
    await this._protocol?.send(packet.data);
  }
  // sendMessage(name: string, buffer: Buffer) {
  //     if (!this.gotHello ||
  // }
  getClient(name: string) {
    return this._plugins.get(name);
  }
}

enum QmlDebugConnectionState {
  NotConnected,
  Unavailable,
  Enabled
}

export interface IQmlDebugClient {
  messageReceived(buffer: Buffer): void;
  stateChanged(state: QmlDebugConnectionState): void;
}
export class QmlDebugClient {
  constructor(
    private readonly _name: string,
    private readonly _connection: QmlDebugConnection
  ) {
    void this._connection.addClient(this._name, this);
  }
  serviceVersion() {
    void this;
    // TODO: Implement
  }
  get name() {
    return this._name;
  }
  get connection() {
    return this._connection;
  }
  stateChanged(state: QmlDebugConnectionState) {
    void state;
    void this;
    throw new Error('Method not implemented.');
  }
  // getState() : QmlDebugConnectionState {
  //     // TODO: Implement
  // }
  // sendMessage(buffer: Buffer) {
  //     if (this.getState() !== QmlDebugConnectionState.Enabled) {
  //         return;
  //     }
  //     this.connection.sendMessage(this.name, buffer);
  // }
}

// BaseEngineDebugClient
export class QmlEngineDebugClient
  extends QmlDebugClient
  implements IQmlDebugClient
{
  public readonly newState = new vscode.EventEmitter<QmlDebugConnectionState>();
  private _nextId = 1;
  constructor(connection: QmlDebugConnection) {
    super('QmlDebugger', connection);
  }
  get nextId() {
    return this._nextId++;
  }
  override stateChanged(state: QmlDebugConnectionState) {
    this.newState.fire(state);
  }
  messageReceived(buffer: Buffer): void {
    void this;
    void buffer;
    // TODO: Implement
  }
}

export class QmlInspectorAgent {
  // private readonly QmlEngineDebugClient: QmlEngineDebugClient | undefined;
  private readonly _connection: QmlDebugConnection | undefined;
  private readonly _engineClient: QmlEngineDebugClient | undefined;
  constructor(connection: QmlDebugConnection) {
    this._connection = connection;
    void this._connection;
    this._engineClient = new QmlEngineDebugClient(connection);
    this._engineClient.newState.event((state) => {
      void state;
      this.updateState();
    });
  }
  updateState() {
    void this;
    logger.info('QmlInspectorAgent: updateState');
  }
}
