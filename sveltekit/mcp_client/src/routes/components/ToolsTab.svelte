<script lang="ts">
  import type { AppState, Tool } from "../state.svelte";

  let { appState }: { appState: AppState } = $props();
</script>

{#if appState.error}
  <div
    class="alert alert-danger d-flex justify-content-between align-items-center"
    role="alert"
  >
    <span>{appState.t.error_tools}{appState.error}</span>
    <button class="btn btn-outline-danger btn-sm" onclick={() => appState.loadTools()}
      >Refresh</button
    >
  </div>
{:else if appState.tools.length === 0}
  <div class="d-flex align-items-center gap-2 p-3">
    <p class="mb-0">{appState.t.loading_tools}</p>
    <button class="btn btn-sm btn-outline-primary" onclick={() => appState.loadTools()}
      >Refresh</button
    >
  </div>
{:else}
  <div class="d-flex justify-content-end mb-2">
    <button class="btn btn-sm btn-outline-secondary" onclick={() => appState.loadTools()}
      >Refresh Tools</button
    >
  </div>
  <div class="list-group">
    {#each appState.tools as tool}
      <div class="list-group-item">
        <div class="d-flex w-100 justify-content-between">
          <h5 class="mb-1">{tool.name}</h5>
        </div>
        <p class="mb-1">{tool.description}</p>
        <small>Schema: {JSON.stringify(tool.inputSchema)}</small>
        <div class="mt-2">
          <button
            class="btn btn-sm btn-primary"
            data-bs-toggle="modal"
            data-bs-target="#toolModal" 
            onclick={() => appState.openToolModal(tool)}>Run</button
          >
        </div>
      </div>
    {/each}
  </div>

{/if}