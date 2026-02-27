<script lang="ts">
  import { onMount } from "svelte";
  import { AppState } from "./state.svelte";
  import CameraTab from "./components/CameraTab.svelte";
  import ControlTab from "./components/ControlTab.svelte";
  import GeminiLiveTab from "./components/GeminiLiveTab.svelte";
  import GeminiCliTab from "./components/GeminiCliTab.svelte";
  import ToolsTab from "./components/ToolsTab.svelte";
  import SettingsTab from "./components/SettingsTab.svelte";

  
  const appState = new AppState();

  // --- Lifecycle Hooks ---
  onMount(() => {
    let mounted = true;
    let cleanupFn = () => {};
    const sse = new EventSource("/mcp");
    sse.onmessage = (e) => console.log("SSE:", e.data);

    appState.init();

    return () => {
      mounted = false;
      sse.close();
      cleanupFn();
    };
  });
</script>

<svelte:head>
  <title>{appState.currentTheme === "spaceship" ? appState.t.theme_spaceship : appState.t.title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link
    rel="preconnect"
    href="https://fonts.gstatic.com"
    crossorigin="anonymous"
  />
  <link
    href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap"
    rel="stylesheet"
  />
  <link
    href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
    rel="stylesheet"
    integrity="sha384-T3c6CoIi6uLrA9TneNEoa7RxnatzjcDSCmG1MXxSR1GAsXEV/Dwwykc2MPK8M2HN"
    crossorigin="anonymous"
  />

  <script
    src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"
    integrity="sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL"
    crossorigin="anonymous"
  ></script>
</svelte:head>

<main class="container mt-3">
  <div>
    <h2>{appState.currentTheme === "spaceship" ? appState.t.theme_spaceship : appState.t.title}</h2>
    <ul
      class="nav nav-tabs mt-3 flex-nowrap overflow-x-auto"
      id="myTab"
      role="tablist"
    >
      <li class="nav-item" role="presentation">
        <button
          class="nav-link active"
          id="camera-tab"
          data-bs-toggle="tab"
          data-bs-target="#camera-tab-pane"
          type="button"
          role="tab"
          aria-controls="camera-tab-pane"
          aria-selected="true">{appState.t.tab_camera}</button
        >
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="pp-tab"
          data-bs-toggle="tab"
          data-bs-target="#pp-tab-pane"
          type="button"
          role="tab"
          aria-controls="pp-tab-pane"
          aria-selected="false">{appState.t.tab_control}</button
        >
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="gemini-cli-tab"
          data-bs-toggle="tab"
          data-bs-target="#gemini-cli-tab-pane"
          type="button"
          role="tab"
          aria-controls="gemini-cli-tab-pane"
          aria-selected="false">{appState.t.tab_gemini_cli}</button
        >
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="gemini-live-tab"
          data-bs-toggle="tab"
          data-bs-target="#gemini-live-tab-pane"
          type="button"
          role="tab"
          aria-controls="gemini-live-tab-pane"
          aria-selected="false">{appState.t.tab_gemini_live}</button
        >
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="home-tab"
          data-bs-toggle="tab"
          data-bs-target="#home-tab-pane"
          type="button"
          role="tab"
          aria-controls="home-tab-pane"
          aria-selected="false">{appState.t.tab_tools}</button
        >
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="settings-tab"
          data-bs-toggle="tab"
          data-bs-target="#settings-tab-pane"
          type="button"
          role="tab"
          aria-controls="settings-tab-pane"
          aria-selected="false">{appState.t.tab_settings}</button
        >
      </li>
    </ul>
    <div
      class="tab-content p-2 border border-top-0 rounded-bottom"
      id="myTabContent"
    >
      <div
        class="tab-pane fade show active"
        id="camera-tab-pane"
        role="tabpanel"
        aria-labelledby="camera-tab"
        tabindex="0"
      >
        <CameraTab {appState} />
      </div>
      <div
        class="tab-pane fade"
        id="pp-tab-pane"
        role="tabpanel"
        aria-labelledby="pp-tab"
        tabindex="0"
      >
        <ControlTab {appState} />
      </div>
      <div
        class="tab-pane fade"
        id="gemini-cli-tab-pane"
        role="tabpanel"
        aria-labelledby="gemini-cli-tab"
        tabindex="0"
      >
        <GeminiCliTab {appState} />
      </div>
      <div
        class="tab-pane fade"
        id="gemini-live-tab-pane"
        role="tabpanel"
        aria-labelledby="gemini-live-tab"
        tabindex="0"
      >
        <GeminiLiveTab {appState} />
      </div>
      <div
        class="tab-pane fade"
        id="home-tab-pane"
        role="tabpanel"
        aria-labelledby="home-tab"
        tabindex="0"
      >
        <ToolsTab {appState} />
      </div>
      <div
        class="tab-pane fade"
        id="settings-tab-pane"
        role="tabpanel"
        aria-labelledby="settings-tab"
        tabindex="0"
      >
        <SettingsTab {appState} />
      </div>
    </div>
  </div>
  <!-- Tool Execution Modal -->
  <div class="modal fade" id="toolModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{appState.selectedTool?.name}</h5>
          <button
            type="button"
            class="btn-close"
            data-bs-dismiss="modal"
            aria-label="Close"
          ></button>
        </div>
        {#if (appState.selectedTool?.inputSchema?.properties && Object.keys(appState.selectedTool.inputSchema.properties).length > 0) || appState.executionResult}
          <div class="modal-body">
            {#if appState.selectedTool?.inputSchema?.properties && Object.keys(appState.selectedTool.inputSchema.properties).length > 0}
              {#each Object.entries(appState.selectedTool.inputSchema.properties) as [key, prop]}
                <div class="mb-3">
                  {#if (prop as any).type === "boolean"}
                    <div class="form-check">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        id="arg-{key}"
                        bind:checked={appState.toolArgs[key]}
                      />
                      <label class="form-check-label" for="arg-{key}">
                        {key}
                      </label>
                    </div>
                  {:else if (prop as any).type === "integer" || (prop as any).type === "number"}
                    <label for="arg-{key}" class="form-label">{key}</label>
                    <input
                      type="number"
                      class="form-control"
                      id="arg-{key}"
                      bind:value={appState.toolArgs[key]}
                      placeholder={(prop as any).description || ""}
                    />
                  {:else}
                    <label for="arg-{key}" class="form-label">{key}</label>
                    <input
                      type="text"
                      class="form-control"
                      id="arg-{key}"
                      bind:value={appState.toolArgs[key]}
                      placeholder={(prop as any).description || ""}
                    />
                  {/if}
                </div>
              {/each}
            {/if}

            {#if appState.executionResult}
              {#if appState.selectedTool?.inputSchema?.properties && Object.keys(appState.selectedTool.inputSchema.properties).length > 0}
                <hr />
              {/if}
              <h6>Result:</h6>
              {#if appState.executionResult.image}
                <img
                  src={appState.executionResult.image}
                  class="img-fluid border rounded"
                  alt="Tool Output"
                />
              {/if}
              {#if appState.executionResult.text}
                <pre
                  class="bg-light p-2 border rounded mt-2"
                  style="white-space: pre-wrap;">{appState.executionResult.text}</pre>
              {/if}
            {/if}
          </div>
        {/if}
        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-secondary"
            data-bs-dismiss="modal">Close</button
          >
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => appState.executeTool()}
            disabled={appState.isExecuting}
          >
            {appState.isExecuting ? "Running..." : "Execute"}
          </button>
        </div>
      </div>
    </div>
  </div>
</main>

<style>
  /* Hide scrollbar for tabs but allow scrolling */
  .nav-tabs::-webkit-scrollbar {
    display: none;
  }
  .nav-tabs {
    -ms-overflow-style: none; /* IE and Edge */
    scrollbar-width: none; /* Firefox */
  }

  /* --- Spaceship Theme --- */
  :global(body.theme-spaceship) {
    background-color: #000;
    font-family: "Orbitron", "Courier New", Courier, monospace;
    color: #e0e0e0;
  }
  :global(body.theme-default) {
    background-color: #fff;
    font-family:
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      "Helvetica Neue",
      "Noto Sans",
      "Liberation Sans",
      Arial,
      sans-serif,
      "Apple Color Emoji",
      "Segoe UI Emoji",
      "Segoe UI Symbol",
      "Noto Color Emoji";
    color: #212529;
  }

  /* タブの状態に応じた背景色を設定 */

  :global(.theme-spaceship .container) {
    --hal-red: #ff2d2d;
    --hal-red-glow: 0 0 2px #ff2d2d, 0 0 5px #ff2d2d;
    --hal-dark-bg: #0a0a0a;
    --hal-card-bg: #121212;
    --hal-border: #444;
    --hal-text: #e0e0e0;
    --hal-text-muted: #b0b0b0; /* Increased brightness for readability */
    --hal-primary: var(--hal-red);
    --hal-primary-glow-text: 0 0 3px #fff, 0 0 5px var(--hal-red);
    color: var(--hal-text);
  }

  :global(.theme-spaceship h2) {
    color: var(--hal-red);
    text-shadow: var(--hal-red-glow);
  }

  :global(.theme-spaceship .nav-tabs) {
    border-bottom-color: var(--hal-border);
  }

  :global(.theme-spaceship .nav-tabs .nav-link) {
    color: var(--hal-text-muted);
    border-color: transparent;
    background: none;
  }
  :global(.theme-spaceship .nav-tabs .nav-link.active) {
    color: var(--hal-text); /* Use standard text color for less contrast */
    background-color: var(--hal-dark-bg); /* Match tab content background */
    border-color: var(--hal-border) var(--hal-border) var(--hal-dark-bg);
  }

  :global(.theme-spaceship .tab-content) {
    background-color: var(--hal-dark-bg);
    border-color: var(--hal-border) !important;
  }

  :global(.theme-spaceship .card) {
    background-color: var(--hal-card-bg);
    border-color: var(--hal-border);
    color: var(--hal-text);
  }

  :global(.theme-spaceship .card-header) {
    background-color: #004d40; /* Teal Green */
    border-bottom-color: #00796b;
    text-shadow: 0 0 4px rgba(160, 255, 192, 0.5);
  }

  :global(.theme-spaceship .bg-light) {
    background-color: #073642 !important; /* Retro dark cyan */
    border-color: var(--hal-border) !important;
  }

  :global(.theme-spaceship .btn-primary) {
    background-color: var(--hal-red);
    border-color: var(--hal-red);
    color: #fff;
    box-shadow: var(--hal-red-glow);
  }
  :global(.theme-spaceship .btn-primary:hover) {
    background-color: #ff5555;
    border-color: #ff5555;
  }
  :global(.theme-spaceship .btn-outline-danger) {
    color: var(--hal-red);
    border-color: var(--hal-red);
  }
  :global(.theme-spaceship .btn-outline-danger:hover),
  :global(.theme-spaceship .btn-danger) {
    color: #fff;
    background-color: var(--hal-red);
    border-color: var(--hal-red);
    box-shadow: var(--hal-red-glow);
  }
  :global(.theme-spaceship .btn-secondary),
  :global(.theme-spaceship .btn-outline-secondary) {
    color: var(--hal-text);
    background-color: #333;
    border-color: #555;
  }
  :global(.theme-spaceship .btn-secondary:hover),
  :global(.theme-spaceship .btn-outline-secondary:hover) {
    background-color: #444;
    border-color: #666;
  }
  :global(.theme-spaceship .btn-success) {
    background-color: #00a800;
    border-color: #00a800;
    color:  #000;
  }

  :global(.theme-spaceship .form-control),
  :global(.theme-spaceship .form-select) {
    background-color: #222;
    border-color: var(--hal-border);
    color: var(--hal-text);
  }
  :global(.theme-spaceship .form-control:focus),
  :global(.theme-spaceship .form-select:focus) {
    background-color: #222;
    border-color: var(--hal-red);
    color: var(--hal-text);
    box-shadow: 0 0 0 0.25rem rgba(255, 45, 45, 0.25);
  }
  :global(.theme-spaceship .form-control:disabled),
  :global(.theme-spaceship .form-select:disabled) {
    background-color: #111;
    border-color: #333;
    color: #444;
  }
  :global(.theme-spaceship .form-check-input) {
    background-color: #333;
    border-color: #555;
  }
  :global(.theme-spaceship .form-check-input:checked) {
    background-color: var(--hal-red);
    border-color: var(--hal-red);
  }
  :global(.theme-spaceship .input-group-text) {
    background-color: #333;
    border-color: var(--hal-border);
    color: var(--hal-text-muted);
  }

  :global(.theme-spaceship .modal-content) {
    background-color: var(--hal-dark-bg);
    border-color: var(--hal-red);
    box-shadow: var(--hal-red-glow);
  }
  :global(.theme-spaceship .modal-header),
  :global(.theme-spaceship .modal-footer) {
    border-bottom-color: var(--hal-border);
    border-top-color: var(--hal-border);
  }
  :global(.theme-spaceship .btn-close) {
    filter: invert(1) grayscale(100%) brightness(200%);
  }

  :global(.theme-spaceship .list-group-item) {
    background-color: var(--hal-card-bg);
    border-color: var(--hal-border);
    color: var(--hal-text);
  }
  :global(.theme-spaceship .list-group-item h5) {
    color: var(--hal-primary);
  }

  :global(.theme-spaceship .alert-danger) {
    background-color: #4d0f0f;
    border-color: var(--hal-red);
    color: var(--hal-text);
  }

  :global(.theme-spaceship .text-muted),
  :global(.theme-spaceship .text-body-secondary) {
    color: var(--hal-text-muted) !important;
  }

  :global(.theme-spaceship .list-group-item h6) {
    color: #d869b4;
    text-shadow: 0 0 5px #d869b4;
  }

  :global(.theme-spaceship .list-group-item small) {
    color: #87cefa;
    text-shadow: 0 0 3px #87cefa;
  }

  /* Monitor Turn-on Effect */
  @keyframes monitor-turn-on {
    0% {
      transform: scale(0.2, 0.002);
      opacity: 0;
      filter: brightness(0) contrast(2);
    }
    10% {
      transform: scale(0.2, 0.002);
      opacity: 1;
      filter: brightness(5) contrast(2);
    }
    40% {
      transform: scale(1, 0.002);
      filter: brightness(5) contrast(2);
    }
    70% {
      transform: scale(1, 1);
      filter: brightness(1.5) contrast(1.2);
    }
    100% {
      transform: scale(1, 1);
      filter: brightness(1) contrast(1);
    }
  }

  .monitor-turn-on {
    animation: monitor-turn-on 0.4s cubic-bezier(0.23, 1, 0.32, 1) forwards;
    transform-origin: center;
  }

  /* Subtle Blink Effect */
  @keyframes blink-subtle {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .blink-subtle {
    animation: blink-subtle 3s infinite ease-in-out;
  }
</style>
