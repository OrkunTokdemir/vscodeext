// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import { Socket } from 'net';

import { createLogger } from 'qt-lib';
import { Packet, PacketProtocol } from '@debug/packet';
import { Timer } from '@debug/timer';

const logger = createLogger('project');

export enum ServerScheme {
  Tcp = 'tcp',
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Socket = 'unix'
}

export enum SocketState {
  UnconnectedState = 0,
  HostLookupState = 1,
  ConnectingState = 2,
  ConnectedState = 3,
  BoundState = 4,
  ListeningState = 5,
  ClosingState = 6
}

export interface Server {
  host: string;
  port: number;
  scheme: ServerScheme;
}

const serverId = 'QDeclarativeDebugServer';
const clientId = 'QDeclarativeDebugClient';
const protocolVersion = 1;

export class QmlDebugConnectionManager {
  private readonly _connectionTimer: Timer = new Timer();
  private _server: Server | undefined;
  private _connection: QmlDebugConnection | undefined;
  private _retryInterval = 400; // 200ms??
  private _maximumRetries = 50; // 10??
  private _numRetries = 0;
  private readonly _connectionOpened = new vscode.EventEmitter<void>();
  private readonly _connectionClosed = new vscode.EventEmitter<void>();
  private readonly _connectionFailed = new vscode.EventEmitter<void>();

  // get numRetries() {
  //   return this._numRetries;
  // }
  // set numRetries(value: number) {
  //   this._numRetries = value;
  // }
  get connection() {
    return this._connection;
  }
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
    const onTimeout = () => {
      if (this.isConnected()) {
        return;
      }
      if (++this._numRetries < this.maximumRetries) {
        if (!this._connection) {
          // If the previous connection failed, recreate it.

          // Assing _connetion explicitly to avoid TS error
          // TODO: Remove the below line and find a better way to handle this
          // Because _connection is already assigned in createConnection()
          this._connection = new QmlDebugConnection();
          this.createConnection();
          if (!this._server) {
            throw new Error('Server not set');
          }
          this._connection.connectToHost(this._server.host, this._server.port);
        } else if (
          this._numRetries < this._maximumRetries &&
          this._connection.socketState() !== SocketState.ConnectedState
        ) {
          // If we don't get connected in the first retry interval, drop the socket and try
          // with a new one. On some operating systems (maxOS) the very first connection to a
          // TCP server takes a very long time to get established and this helps.
          // On other operating systems (windows) every connection takes forever to get
          // established. So, after tearing down and rebuilding the socket twice, just
          // keep trying with the same one.
          if (!this._server) {
            throw new Error('Server not set');
          }
          this._connection.connectToHost(this._server.host, this._server.port);
        } // Else leave it alone and wait for hello.
      } else {
        // On final timeout, clear the connection.
        this.stopConnectionTimer();
        this.destroyConnection();
        this._connectionFailed.fire();
      }
    };
    this._connectionTimer.onTimeout(() => {
      onTimeout();
    });
    this._connectionTimer.start(this._retryInterval);

    if (this._connection) {
      this._connection.connectToHost(this._server.host, this._server.port);
    }
  }
  stopConnectionTimer() {
    this._connectionTimer.stop();
  }
  destroyConnection() {
    if (this._connection) {
      this._connection.disconnect();
      this._connection = undefined;
      this._connectionTimer.stop();
      this._connectionTimer.disconnect();
      // destroyClients(); TODO: Needs this?
      this._numRetries = 0;
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
    this.stopConnectionTimer();
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
  private readonly _serverPlugins = new Map<string, number>();
  private _device: Socket | undefined;
  private _protocol: PacketProtocol | undefined;
  private static readonly minStreamVersion = 12;
  private _currentDataStreamVersion = QmlDebugConnection.minStreamVersion;
  private readonly _maximumDataStreamVersion = 23; // Qt_DefaultCompiledVersion??
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
  socketState() {
    if (!this._device) {
      return SocketState.UnconnectedState;
    }
    if (this._device.readyState === 'open') {
      return SocketState.ConnectedState;
    }
    if (
      this._device.connecting ||
      this._device.readyState === 'opening' ||
      this._device.pending
    ) {
      return SocketState.ConnectingState;
    }
    if (this._device.destroyed || this._device.closed) {
      return SocketState.UnconnectedState;
    }
    throw new Error('Unknown socket state');
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
      logger.error('Error connecting to host:' + error.stack);
      this.socketDisconnected();
    });
    this._device.on('connect', () => {
      logger.info('Connected to host');
      void this.socketConnected();
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
    if (!this._protocol) {
      throw new Error('Protocol not set');
    }
    // TODO: Implement
    if (!this._gotHello) {
      const pack = this._protocol.read();
      const name = pack.readStringUTF16LE();
      let validHello = false;
      if (name === clientId) {
        const op = pack.readInt32BE();
        if (op == 0) {
          const version = pack.readInt32BE();
          if (version == protocolVersion) {
            const pluginNames = pack.readArrayString();
            const pluginNamesSize = pluginNames.length;
            const pluginVersions = pack.readArrayDouble();
            const pluginVersionsSize = pluginVersions.length;
            for (let i = 0; i < pluginNamesSize; i++) {
              let pluginVersion = 1.0;
              //   if (i < pluginVersionsSize)
              //     pluginVersion = pluginVersions.at(i);
              // d->serverPlugins.insert(pluginNames.at(i), pluginVersion);
              if (i < pluginVersionsSize) {
                const temp = pluginVersions[i];
                if (!temp) {
                  throw new Error('Plugin version is not a number');
                }
                pluginVersion = temp;
              }
              const tempPluginName = pluginNames[i];
              if (!tempPluginName) {
                throw new Error('Plugin name is not a string');
              }
              this._serverPlugins.set(tempPluginName, pluginVersion);
            }
            //   if (!pack.atEnd()) {
            //     pack >> d->currentDataStreamVersion;
            //     if (d->currentDataStreamVersion > d->maximumDataStreamVersion)
            //         qWarning() << "Server returned invalid data stream version!";
            // }
            // validHello = true;
            if (!pack.atEnd()) {
              // d->currentDataStreamVersion = pack.readInt32BE();
              this._currentDataStreamVersion = pack.readInt32BE();
              // if (d->currentDataStreamVersion > d->maximumDataStreamVersion) {
              //     console.warn('Server returned invalid data stream version!');
              // }
              if (
                this._currentDataStreamVersion > this._maximumDataStreamVersion
              ) {
                logger.warn('Server returned invalid data stream version!');
              }
              validHello = true;
            }
          }
        }
      }

      if (!validHello) {
        logger.warn('QML Debug Client: Invalid hello message');
        this.close();
        return;
      }
      this._gotHello = true;
      for (const [key, value] of this._plugins) {
        let newState = QmlDebugConnectionState.Unavailable;
        if (this._serverPlugins.has(key)) {
          newState = QmlDebugConnectionState.Enabled;
        }
        value.stateChanged(newState);
      }
      this._connected.fire();
    }
    while (this._protocol.packetsAvailable()) {
      const pack = this._protocol.read();
      const name = pack.readStringUTF16LE();

      if (name === clientId) {
        const op = pack.readInt32BE();
        if (op === 1) {
          // Service Discovery
          const oldServerPlugins = new Map(this._serverPlugins);
          this._serverPlugins.clear();

          const pluginNames = pack.readArrayString();
          let pluginVersions: number[] | undefined;
          if (!pack.atEnd()) {
            pluginVersions = pack.readArrayDouble();
          }
          // const int pluginNamesSize = pluginNames.size();
          // const int pluginVersionsSize = pluginVersions.size();
          const pluginNamesSize = pluginNames.length;
          const pluginVersionsSize = pluginVersions ? pluginVersions.length : 0;
          for (let i = 0; i < pluginNamesSize; i++) {
            let pluginVersion = 1.0;
            if (pluginVersions && i < pluginVersionsSize) {
              const temp = pluginVersions[i];
              if (!temp) {
                throw new Error('Plugin version is not a number');
              }
              pluginVersion = temp;
            }
            const tempPluginName = pluginNames[i];
            if (!tempPluginName) {
              throw new Error('Plugin name is not a string');
            }
            this._serverPlugins.set(tempPluginName, pluginVersion);
          }
          for (const [pluginName, plugin] of this._plugins) {
            let newState = QmlDebugConnectionState.Unavailable;
            if (this._serverPlugins.has(pluginName)) {
              newState = QmlDebugConnectionState.Enabled;
            }

            if (
              oldServerPlugins.has(pluginName) !=
              this._serverPlugins.has(pluginName)
            ) {
              plugin.stateChanged(newState);
            }
          }
        } else {
          logger.warn('QML Debug Client: Unknown control message id' + op);
        }
      } else {
        const client = this._plugins.get(name);
        if (!client) {
          logger.warn(
            'QML Debug Client: Message received for missing plugin' + name
          );
        } else {
          while (!pack.atEnd()) {
            const subPacket = pack.readSubDataStream();
            client.messageReceived(subPacket);
          }
        }
      }
    }
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
  messageReceived(packet: Packet): void;
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
  messageReceived(packet: Packet): void {
    void this;
    void packet;
    throw new Error('Method not implemented.');
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
  override messageReceived(packet: Packet): void {
    void this;
    void packet;
    // TODO: Implement
  }
}

export class DebugMessageClient
  extends QmlDebugClient
  implements IQmlDebugClient
{
  constructor(connection: QmlDebugConnection) {
    super('DebugMessages', connection);
  }
  override messageReceived(packet: Packet): void {
    const messageHeader = packet.readStringUTF8();
    if (messageHeader !== 'MESSAGE') {
      return;
    }
    const type = packet.readInt32BE();
    const message = packet.readStringUTF8();
    const filename = packet.readStringUTF8();
    const line = packet.readInt32BE();
    const functionName = packet.readStringUTF8();
    const category = packet.readStringUTF8();
    const elapsedSeconds = Number(packet.readInt64BE() / BigInt(1000000000));
    void this,
      type,
      message,
      filename,
      line,
      functionName,
      category,
      elapsedSeconds;
  }
  override stateChanged(state: QmlDebugConnectionState): void {
    void state;
    void this;
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
