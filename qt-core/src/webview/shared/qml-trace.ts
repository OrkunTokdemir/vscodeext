// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

export type FlameGraphKind = 'time' | 'memory' | 'allocations';

export type QmlTraceCommandReply =
  | { folders: string[] }
  | { themeKind: string }
  | { status: 'done' }
  | {
      fileName: string;
      filePath: string;
      additionalDirs: string[];
      viewer: {
        path: string;
        valid: boolean;
      };
    };
