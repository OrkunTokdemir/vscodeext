/* Copyright (C) 2026 The Qt Company Ltd.
 *
 * SPDX-License-Identifier: LicenseRef-Qt-Commercial OR GPL-3.0-only WITH Qt-GPL-exception-1.0
 */

/**
 * Unit tests for the OIDC login module (PKCE, discovery, token exchange,
 * identity resolution, credential persistence).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeS256Challenge,
  generatePkcePair,
  generateState
} from '../../src/oidc';

// ── PKCE utilities ───────────────────────────────────────────────────────────

describe('PKCE utilities', () => {
  it('computes the RFC 7636 Appendix B challenge', () => {
    // Official test vector from RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    assert.equal(
      computeS256Challenge(verifier),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('generates a verifier of valid length and charset', () => {
    const { verifier, challenge } = generatePkcePair();
    // RFC 7636: 43-128 chars of [A-Za-z0-9-._~]; base64url gives a subset.
    assert.ok(verifier.length >= 43 && verifier.length <= 128);
    assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
    assert.equal(challenge, computeS256Challenge(verifier));
  });

  it('generates unique verifiers and states', () => {
    assert.notEqual(generatePkcePair().verifier, generatePkcePair().verifier);
    const state = generateState();
    assert.ok(state.length >= 16);
    assert.notEqual(state, generateState());
  });
});
