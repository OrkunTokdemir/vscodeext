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
import * as http from 'http';
import type { AddressInfo } from 'net';

import {
  computeS256Challenge,
  generatePkcePair,
  generateState,
  QtLoginOidc,
  OIDC_SCOPES
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

// ── Test HTTP server helper ──────────────────────────────────────────────────

interface TestServer {
  url: string;
  close: () => void;
}

async function startServer(handler: http.RequestListener): Promise<TestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () => server.close()
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

// ── Discovery & authorization URL ────────────────────────────────────────────

describe('QtLoginOidc.beginLogin', () => {
  it('builds the authorization URL from the discovery document', async () => {
    let discoveryHits = 0;
    let baseUrl = '';
    const srv = await startServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        discoveryHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            authorization_endpoint: `${baseUrl}/custom/authorize`,
            token_endpoint: `${baseUrl}/custom/token`,
            userinfo_endpoint: `${baseUrl}/custom/userinfo`
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    baseUrl = srv.url;

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    const attempt = await oidc.beginLogin(
      'vscode://theqtcompany.qt-sm/authenticate'
    );

    const url = new URL(attempt.authorizationUrl);
    assert.equal(url.origin + url.pathname, `${srv.url}/custom/authorize`);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'cid-1');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'vscode://theqtcompany.qt-sm/authenticate'
    );
    assert.equal(url.searchParams.get('scope'), OIDC_SCOPES);
    assert.equal(url.searchParams.get('state'), attempt.state);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(
      url.searchParams.get('code_challenge'),
      computeS256Challenge(attempt.codeVerifier)
    );
    assert.equal(
      attempt.redirectUri,
      'vscode://theqtcompany.qt-sm/authenticate'
    );

    // Discovery result is cached across calls.
    await oidc.beginLogin('vscode://theqtcompany.qt-sm/authenticate');
    assert.equal(discoveryHits, 1);
    srv.close();
  });

  it('falls back to default endpoints when discovery fails', async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    const attempt = await oidc.beginLogin(
      'vscode://theqtcompany.qt-sm/authenticate'
    );
    assert.ok(attempt.authorizationUrl.startsWith(`${srv.url}/authorize?`));
    srv.close();
  });
});
