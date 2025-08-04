<!--
Copyright (C) 2025 The Qt Company Ltd.
SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only
-->

<script lang="ts">
  import { onMount } from 'svelte';

  import '@/styles/app.css';
  import * as texts from '@/apps/texts';
//   import DropMask from '@/comps/DropMask.svelte';
//   import { DragDropHandler } from '@/comps/DragDropHandler.svelte';

//   import QrcView from './QrcView.svelte';
//   import QrcPropInput from './QrcPropInput.svelte';
//   import QrcEditorHeader from './QrcEditorHeader.svelte';
//   import { data } from './states.svelte';
  import * as viewlogic from './viewlogic.svelte';
    import * as ts from 'typescript';
//   import type { GroupNodeWrapper } from './types.svelte';

//   let numGroups = $derived(data.groups.length);
//   let numFiles = $derived.by(() => {
//     return data.groups.reduce(
//       (sum: number, g: GroupNodeWrapper) => sum + (g.numFiles()), 0
//     );
//   });

//   let dnd = $state(undefined as DragDropHandler | undefined);
  let dropTarget: HTMLElement;;

  function openWithLinguist() {
    // TODO: Implement open in Linguist action
    alert('Open in Linguist clicked');
  }

  function openWithTextEditor() {
    // TODO: Implement open in Text Editor action
    alert('Open in Text Editor clicked');
  }

  onMount(() => {
    // dnd = new DragDropHandler(dropTarget);
    // dnd.onDrop = (files: string[]) => { viewlogic.addFiles(files); };
    // dnd.attach();

    viewlogic.onAppMount();
  });

//   onDestroy(() => dnd?.detach());
</script>

<div class='w-screen h-screen p-2 flex flex-col gap-2'>
  <div class="flex justify-center items-center my-8 gap-3">
    <button id="openWithDesignerButton"
      class="px-4 py-2 bg-blue-600 text-white rounded"
      type="button"
      on:click={openWithLinguist}>
      <!-- text -->
      {texts.ts.buttons.OpenInLinguist}
    </button>
    <button id="openWithTextEditorButton"
      class="px-4 py-2 bg-gray-600 text-white rounded ml-3"
      type="button"
      on:click={openWithTextEditor}>
      {texts.ts.buttons.OpenInTextEditor}
    </button>
  </div>
  <!-- header -->
  <!-- <QrcEditorHeader /> -->

  <!-- list with drop mask -->
  <!-- <div class="flex-1 p-2 qt-surface flex flex-col gap-2 min-h-0">
    {texts.qrc.stats(numGroups, numFiles)}

    <div bind:this={dropTarget} class="flex-1 min-h-0 relative">
      <QrcView />

    </div>
  </div> -->

  <!-- input panel -->
  <!-- <QrcPropInput /> -->
</div>
