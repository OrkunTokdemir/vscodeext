// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

export class DataStream {
    private _data = Buffer.alloc(0);
    private readOffset = 0;
    private writeOffset = 0;

    constructor(data?: Buffer) {
        if (data) {
            this.data = data;
        } else {
            this.data = Buffer.alloc(0);
        }
    }
    get data() {
        return this._data.subarray(0, this.writeOffset);
    }
    set data(data: Buffer) {
        this._data = data;
        this.writeOffset = 0;
        this.readOffset = 0;
    }
    writeInt8(value: number) {
        const newValueSize = 1;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeInt8(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeInt16LE(value: number) {
        const newValueSize = 2;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeInt16LE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeInt16BE(value: number) {
        const newValueSize = 2;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeInt16BE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeInt32LE(value: number) {
        const newValueSize = 4;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeInt32LE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeInt32BE(value: number) {
        const newValueSize = 4;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeInt32BE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeInt64LE(value: bigint) {
        const newValueSize = 8;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeBigInt64LE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeInt64BE(value: bigint) {
        const newValueSize = 8;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeBigInt64BE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeFloatLE(value: number) {
        const newValueSize = 4;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeFloatLE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeFloatBE(value: number) {
        const newValueSize = 4;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeFloatBE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeDoubleLE(value: number) {
        const newValueSize = 8;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeDoubleLE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeDoubleBE(value: number) {
        const newValueSize = 8;
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.writeDoubleBE(value, this.writeOffset);
        this.writeOffset += newValueSize;
    }
    writeStringUTF8(value: string) {
        const newValueSize = Buffer.byteLength(value, 'utf8');
        this.ensureCapacity(this.writeOffset + newValueSize);
        this._data.write(value, this.writeOffset, 'utf8');
        this.writeOffset += newValueSize;
    }
    writeBoolean(value: boolean) {
        this.writeInt8(value ? 1 : 0);
    }
    // writeStringUTF16LE(value: string) {
    //     const newValueSize = Buffer.byteLength(value, 'utf16le');
    //     this.ensureCapacity(this.writeOffset + newValueSize);
    //     this._data.write(value, this.writeOffset, 'utf16le');
    //     this.writeOffset += newValueSize;
    // }
    writeStringUTF16(value: string) {
        const newValueSize = Buffer.byteLength(value, 'ucs-2');
        this.ensureCapacity(this.writeOffset + newValueSize);
        const stringBuffer = Buffer.from(value, "ucs-2").swap16();
        stringBuffer.copy(this._data, this.writeOffset);
        // this._data.write(value, this.writeOffset, 'ucs-2'); // Needs swap16?
        // this.writeOffset += newValueSize;
    }
    writeContainer<T>(container: T, writeFunc: (stream: DataStream, value: unknown) => void) {
        for (const key in container) {
            writeFunc(this, container[key]);
        }
    }
    readInt8(): number {
        const value = this._data.readInt8(this.readOffset);
        this.readOffset += 1;
        return value;
    }
    readInt16LE(): number {
        const value = this._data.readInt16LE(this.readOffset);
        this.readOffset += 2;
        return value;
    }
    readInt16BE(): number {
        const value = this._data.readInt16BE(this.readOffset);
        this.readOffset += 2;
        return value;
    }
    readInt32LE(): number {
        const value = this._data.readInt32LE(this.readOffset);
        this.readOffset += 4;
        return value;
    }
    readInt32BE(): number {
        const value = this._data.readInt32BE(this.readOffset);
        this.readOffset += 4;
        return value;
    }
    readInt64LE(): bigint {
        const value = this._data.readBigInt64LE(this.readOffset);
        this.readOffset += 8;
        return value;
    }
    readInt64BE(): bigint {
        const value = this._data.readBigInt64BE(this.readOffset);
        this.readOffset += 8;
        return value;
    }
    readFloatLE(): number {
        const value = this._data.readFloatLE(this.readOffset);
        this.readOffset += 4;
        return value;
    }
    readFloatBE(): number {
        const value = this._data.readFloatBE(this.readOffset);
        this.readOffset += 4;
        return value;
    }
    readDoubleLE(): number {
        const value = this._data.readDoubleLE(this.readOffset);
        this.readOffset += 8;
        return value;
    }
    readDoubleBE(): number {
        const value = this._data.readDoubleBE(this.readOffset);
        this.readOffset += 8;
        return value;
    }
    readStringUTF8(length: number): string {
        const value = this._data.toString('utf8', this.readOffset, this.readOffset + length);
        this.readOffset += length;
        return value;
    }
    readStringUTF16LE(length: number): string {
        const bytesLen = length * 2;
        const value = this._data.toString('utf16le', this.readOffset, this.readOffset + bytesLen);
        this.readOffset += bytesLen;
        return value;
    }
    readStringUTF16BE(length: number): string {
        const bytesLen = length * 2;
        const value = this._data.toString('ucs-2', this.readOffset, this.readOffset + bytesLen);
        this.readOffset += length;
        return value;
    }
    resize(newSize: number) {
        const newData = Buffer.alloc(newSize);
        this._data.copy(newData);
        this._data = newData;
    }
    ensureCapacity(capacity: number) {
        const increaseFactor = 2;
        if (this._data.byteLength === 0) {
            this.resize(10);
        }
        if (this._data.byteLength < capacity) {
            let newSize = this._data.byteLength * increaseFactor;
            while (newSize < capacity) {
                newSize *= increaseFactor;
            }
            console.log(`Resizing buffer from ${this._data.byteLength} to ${newSize}`);
            this.resize(newSize);
        }
    }
}