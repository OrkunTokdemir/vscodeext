<!--
Copyright (C) 2026 The Qt Company Ltd.
SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only
-->

<script lang="ts">
  import { onMount, type Component } from 'svelte';

  import '@/styles/app.css';
  import { ExternalLink, Text } from '@lucide/svelte';
  import * as viewlogic from './viewlogic.svelte';

  const buttons = [
    {
      icon: ExternalLink,
      texts: ['QML trace viewer'],
      onClicked: () => {
        void viewlogic.openFileInTraceViewer();
      }
    },
    {
      icon: Text,
      texts: ['Text editor'],
      onClicked: () => {
        void viewlogic.openFileInTextEditor();
      }
    }
  ];

  onMount(async () => {
    void viewlogic.onAppMount();
  });
</script>

<div class='w-screen h-screen p-2 flex flex-col gap-2'>
  <div class='
    w-full h-full
    flex flex-row items-center justify-center gap-6
  '>
    {#each buttons as b, i (i)}
      {@render LargeButton(b.icon, b.texts, b.onClicked)}
    {/each}

  </div>
</div>

{#snippet LargeButton(Icon: Component, texts: string[], onClicked: () => void)}
  <button class='
    qt-button-flat
    w-[150px] h-[150px]
    flex flex-col justify-center items-center gap-8 px-5
  '
    onclick={onClicked}
  >
    <Icon class='medium'/>
    <p class='leading-relaxed'>
      {#each texts as t, i (i)}
        {t}<br>
      {/each}
    </p>
  </button>
{/snippet}