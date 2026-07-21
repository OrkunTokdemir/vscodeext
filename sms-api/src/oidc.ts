/* Copyright (C) 2026 The Qt Company Ltd.
 *
 * SPDX-License-Identifier: LicenseRef-Qt-Commercial OR GPL-3.0-only WITH Qt-GPL-exception-1.0
 */

/**
 * Browser-based Qt Account login — OIDC authorization code + PKCE against
 * login.qt.io. Client side of QTPIF-268 (SMS: Qt login OIDC support to
 * client).
 *
 * Provides:
 *   - PKCE / state helpers (RFC 7636)
 *   - QtLoginOidc: discovery, authorization URL, code exchange, token
 *     refresh, identity resolution, credential persistence via
 *     QtAccountStorage (qtaccount.ini — shared with the C++ service)
 */

import * as crypto from 'crypto';

// ── Constants ────────────────────────────────────────────────────────────────

export const OIDC_SCOPES = 'openid email offline_access';

// ── PKCE / state helpers (RFC 7636) ──────────────────────────────────────────

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** S256 code challenge for a given verifier (RFC 7636 §4.2). */
export function computeS256Challenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Random PKCE verifier (43 base64url chars) and its S256 challenge. */
export function generatePkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: computeS256Challenge(verifier) };
}

/** Random opaque `state` value binding a callback to a login attempt. */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}
