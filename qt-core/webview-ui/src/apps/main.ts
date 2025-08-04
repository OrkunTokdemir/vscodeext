// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { mount } from 'svelte';
import NewItem from './new-item/NewItemApp.svelte';
import QrcEditor from './qrc-editor/QrcEditorApp.svelte';
import TsEditor from './ts-editor/TsEditorApp.svelte';

const appType = document.body.dataset.app;

function getAppType(appType: string | undefined): typeof NewItem | typeof QrcEditor | typeof TsEditor {
  if (!appType) {
    throw new Error('App type is not defined in the document body data attribute.');
  }
  switch (appType) {
    case 'new-item':
      return NewItem;
    case 'qrc-editor':
      return QrcEditor;
    case 'ts-editor':
      return TsEditor;
  }
  throw new Error(`Unknown app type: ${appType}`);
}
const appComp = getAppType(appType);

const app = mount(appComp, {
  target: document.getElementById('app')!
});

export default app;
