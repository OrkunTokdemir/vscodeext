// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { expect } from 'chai';
import type { QtNewItemProvider } from 'qt-lib';
import {
  getNewItemProviders,
  registerNewItemProvider
} from '@/webview/new-item/provider.js';

const provider: QtNewItemProvider = {
  id: 'test-provider',
  getPresets: () => [],
  getPreset: () => undefined,
  validate: () => [],
  create: () => {
    throw new Error('Not used');
  }
};

describe('New Item providers', () => {
  it('registers and disposes providers', () => {
    const registration = registerNewItemProvider(provider);
    expect(getNewItemProviders()).to.include(provider);

    registration.dispose();
    expect(getNewItemProviders()).not.to.include(provider);
  });

  it('rejects duplicate provider IDs', () => {
    const registration = registerNewItemProvider(provider);
    expect(() => registerNewItemProvider(provider)).to.throw(
      "New Item provider 'test-provider' is already registered"
    );
    registration.dispose();
  });
});
