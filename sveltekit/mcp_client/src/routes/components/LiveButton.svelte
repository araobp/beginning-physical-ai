<script lang="ts">
  import type { AppState } from "../state.svelte";

  let { 
    appState, 
    isLive, 
    onToggle 
  }: { 
    appState: AppState; 
    isLive: boolean; 
    onToggle: () => void; 
  } = $props();
</script>

<button
  class="btn {isLive ? 'btn-danger' : 'btn-outline-danger'} btn-sm"
  onclick={onToggle}
  class:spaceship-glow={appState.currentTheme === 'spaceship'}
>
  {isLive ? appState.t.stop_live : appState.t.live}
</button>

<style>
  .spaceship-glow {
    text-shadow: 0 0 8px rgba(255, 255, 255, 0.8) !important;
    box-shadow: 0 0 8px rgba(255, 45, 45, 0.6) !important;
  }
</style>