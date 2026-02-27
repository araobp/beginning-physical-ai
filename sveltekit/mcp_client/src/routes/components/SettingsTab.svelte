<script lang="ts">
  import type { AppState } from "../state.svelte";

  let { appState }: { appState: AppState } = $props();
</script>

<div class="p-3">
  <div class="mb-3">
    <label for="langSelect" class="form-label">{appState.t.settings_lang}</label>
    <select
      class="form-select w-auto"
      id="langSelect"
      bind:value={appState.currentLang}
    >
      <option value="ja">日本語</option>
      <option value="en">English</option>
    </select>
  </div>
  <div class="mb-3">
    <label class="form-label">{appState.t.theme_settings}</label>
    <div class="btn-group" role="group" aria-label="Theme selector">
      <input
        type="radio"
        class="btn-check"
        name="themeRadio"
        id="themeDefault"
        autocomplete="off"
        bind:group={appState.currentTheme}
        value="default"
      />
      <label class="btn btn-outline-primary" for="themeDefault"
        >{appState.t.theme_default}</label
      >

      <input
        type="radio"
        class="btn-check"
        name="themeRadio" id="themeSpaceship"
        autocomplete="off"
        bind:group={appState.currentTheme}
        value="spaceship"
      />
      <label class="btn btn-outline-primary" for="themeSpaceship"
        >{appState.t.theme_spaceship}</label
      >
    </div>
  </div>
</div>