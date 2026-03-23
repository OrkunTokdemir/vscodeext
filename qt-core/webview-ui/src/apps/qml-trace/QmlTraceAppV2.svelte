<!--
Copyright (C) 2026 The Qt Company Ltd.
SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only
-->

<script lang="ts">
  import { onMount } from 'svelte';

  import '@/styles/app.css';
  import { ExternalLink, Settings } from '@lucide/svelte';
  import IconButton from '@/comps/IconButton.svelte';
  import { data } from './states.svelte';
  import * as viewlogic from './viewlogic.svelte';

  onMount(async () => {
    void viewlogic.onAppMount();
  });
</script>

<div class='w-screen h-screen p-2 flex flex-col gap-2'>
  <div class='
    w-[300px] h-full
    flex flex-col mx-auto gap-1 justify-center
  '>
    {@render RunViewerButton()}
    {@render ConfigAndOpenAsTextButton()}
  </div>
</div>

{#snippet RunViewerButton()}
  <button class='
    qt-button
    w-full min-h-[60px]
    flex flex-row justify-center items-center gap-4 px-5
    bg-amber-600
  '
    onclick={() => {
      void viewlogic.openFileInTraceViewer();
    }}
  >
    <ExternalLink/>
    <p>Open in a QML trace viewer</p>
  </button>
{/snippet}

{#snippet ConfigAndOpenAsTextButton()}
  <div class='flex flex-row items-center'>
    {#if data.configs.fileName.endsWith('.qtd')}
      {@render OpenAsTextButton()}
    {/if}
    <div class='grow'></div>
    <IconButton
      flat square
      class="!w-0 !border-none"
      icon={Settings}
    />
  </div>
{/snippet}

{#snippet OpenAsTextButton()}
  <button
    class='underline underline-offset-3 text-gray-500'
    onclick={() => {
      void viewlogic.openFileInTextEditor();
    }}
  >
    Open as text
  </button>
{/snippet}