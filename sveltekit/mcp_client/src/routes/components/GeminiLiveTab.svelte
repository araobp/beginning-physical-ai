<script lang="ts">
  import type { AppState } from "../state.svelte";
  import { getColorForObject, getTextColor } from "$lib/utils";

  let { appState }: { appState: AppState } = $props();
  let reasoningPathLogElement: HTMLElement | null = null;

  $effect(() => {
    // These are dependencies for the effect
    appState.geminiLiveLog.length;
    if (appState.geminiLiveLog.length > 0) {
      // Track content of the last log entry to trigger scroll on streaming updates
      const last = appState.geminiLiveLog[appState.geminiLiveLog.length - 1];
      last.content;
      last.toolResult;
    }
    appState.geminiInterimTranscript;
    
    if (reasoningPathLogElement) {
      // Scroll to bottom when log changes
      reasoningPathLogElement.scrollTop = reasoningPathLogElement.scrollHeight;
    }
  });
</script>

<div class="container-fluid mt-1 mb-1">
  <div class="row mb-3">
    <div class="col-12 d-flex align-items-center gap-3">
      <button class="btn {appState.geminiLive ? 'btn-danger' : 'btn-outline-danger'}"
        onclick={() => appState.toggleGeminiLive()}
        class:spaceship-glow={appState.currentTheme === 'spaceship' && appState.geminiLive}
      >
        {appState.geminiLive ? appState.t.stop_live : appState.t.live}
      </button>
      <span class="text-muted">{appState.t.gemini_live_monitor_desc}</span>
    </div>
  </div>
  <div class="row">
    <!-- Left: Live Monitor -->
    <div class="col-md-6 d-flex flex-column gap-3">
      <div class="card rounded-bottom-0">
        <div class="card-header">Live Monitor</div>
        <div
          class="card-body text-center p-0 bg-dark position-relative d-flex align-items-center justify-content-center"
          style="height: 350px; overflow: hidden;"
        >
          {#if appState.geminiLive}
            <img
              src={appState.geminiLiveMonitorImageSrc}
              alt="Gemini Monitor View"
              class="img-fluid"
              class:monitor-turn-on={appState.geminiLiveMonitorLoaded}
              class:opacity-0={!appState.geminiLiveMonitorLoaded}
              style="max-height: 100%; max-width: 100%;"
              onload={(e) => {
                appState.geminiLiveMonitorLoaded = true;
                const img = e.currentTarget as HTMLImageElement;
                appState.geminiImageDim = {
                  w: img.naturalWidth,
                  h: img.naturalHeight,
                };
              }}
            />

            <!-- Detections Overlay -->
            {#each appState.geminiDetections as obj}
              {@const color = getColorForObject(obj)}
              <div
                style="position: absolute; left: {obj.box_2d[1] / 10}%; top: {obj.box_2d[0] / 10}%; width: {(obj.box_2d[3] - obj.box_2d[1]) / 10}%; height: {(obj.box_2d[2] - obj.box_2d[0]) / 10}%; border: 2px solid {color}; pointer-events: none; z-index: 5;"
              >
                <span
                  style="background: {color}; color: {getTextColor(color)}; position: absolute; top: -1.5em; left: 0; padding: 0 2px; font-size: 0.8em; white-space: nowrap;"
                >
                  {obj.label}{obj.color_name ? ` (${obj.color_name})` : ""} ({obj.confidence.toFixed(2)})
                </span>
              </div>
              {#if obj.ground_center && !Array.isArray(obj.ground_center)}
                {@const groundContactX = obj.ground_center.u_norm / 10}
                {@const groundContactY = obj.ground_center.v_norm / 10}
                {#if obj.label.endsWith("_ok") && obj.ground_center.radius_u_norm}
                  <div
                    style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: {(obj.ground_center.radius_u_norm / 10) * 2}%; height: {(obj.ground_center.radius_v_norm / 10) * 2}%; border: 1px dashed {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; opacity: 0.7; z-index: 5;"
                  ></div>
                {/if}
                {#if obj.ground_center.u_top_norm !== undefined}
                  {@const topX = obj.ground_center.u_top_norm / 10}
                  {@const topY = obj.ground_center.v_top_norm / 10}
                  <svg
                    style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;"
                  >
                    <line
                      x1="{groundContactX}%"
                      y1="{groundContactY}%"
                      x2="{topX}%"
                      y2="{topY}%"
                      stroke={color}
                      stroke-width="2"
                      stroke-dasharray="4"
                    />
                  </svg>
                  <div
                    style="position: absolute; left: {topX}%; top: {topY}%; width: 6px; height: 6px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5;"
                  ></div>
                {/if}
                <div
                  style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: 10px; height: 10px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5;"
                ></div>
              {/if}
            {/each}

            <!-- Trajectory Overlay -->
            {#if appState.geminiTrajectoryPoints.length > 0 && appState.geminiImageDim}
              <svg
                viewBox="0 0 {appState.geminiImageDim.w} {appState.geminiImageDim.h}"
                style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4;"
              >
                <polyline
                  points={appState.geminiTrajectoryPoints.map((p) => `${p.u},${p.v}`).join(" ")}
                  fill="none"
                  stroke="deeppink"
                  stroke-width="3"
                  stroke-dasharray="5,5"
                />
                {#each appState.geminiTrajectoryPoints as p}
                  <circle cx={p.u} cy={p.v} r="3" fill="deeppink" />
                {/each}
              </svg>
            {/if}
          {:else}
            <div
              class="d-flex align-items-center justify-content-center h-100 blink-subtle"
              style="color: #00bb00; font-family: 'Orbitron', monospace; letter-spacing: 2px;"
            >
              <p>Offline</p>
            </div>
          {/if}
        </div>
      </div>
      <div class="card special-bg">
        <div class="card-header">Status</div>
        <div class="card-body">
          <div class="live-status-header">
            <div class="mb-3">
              Status: <span
                class={appState.geminiStatus === "Connected" ? "text-success" : "text-muted"}
                style={appState.geminiStatus === "Connected" && appState.currentTheme === "spaceship" ? "color: #00ff00 !important; text-shadow: 0 0 8px rgba(0, 255, 0, 0.6);" : ""}
              >
                {appState.geminiStatus}
              </span>
            </div>
            <div class="audio-levels">
              <div class="level-row">
                <span class="label" style="width: 80px;">Mic</span>
                <div class="meter">
                  <div class="fill" style="width: {Math.min(100, appState.geminiMicLevel * 30)}%"></div>
                </div>
              </div>
              <div class="level-row">
                <span class="label" style="width: 80px;">Speaker</span>
                <div class="meter">
                  <div class="fill" style="width: {Math.min(100, appState.geminiSpeakerLevel * 100)}%"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Right: Conversation Log -->
    <div class="col-md-6">
      <div class="card h-100 d-flex flex-column special-bg" style="max-height: 600px;">
        <div class="card-header">{appState.t.gemini_live_reasoning_path_header}</div>
        <div class="card-body p-0 d-flex flex-column" style="overflow: hidden;">
          {#if !appState.geminiLive}
            <div class="p-3 text-center text-muted">
              <p>Press the "Live" button above the monitor to start voice control.</p>
              <p>Try saying: "What do you see?"</p>
            </div>
          {:else}
            <div class="reasoning-path-log flex-grow-1 overflow-auto p-2" style="min-height: 0;" bind:this={reasoningPathLogElement}>
              {#each appState.geminiLiveLog as log, i (i)}
                {#if log.source === 'tool'}
                  <div class="log-entry log-tool">
                    <div class="d-flex w-100 justify-content-between">
                      <h6 class="mb-1">{log.toolName}</h6>
                      <small>{new Date(log.timestamp).toLocaleTimeString()}</small>
                    </div>
                    <div class="mb-1 small">
                      <strong>Args:</strong> <span class="text-muted text-break">{JSON.stringify(log.toolArgs)}</span>
                    </div>
                    <div class="small">
                      <strong>Result:</strong> <span class="text-muted text-break">{log.toolResult || '...'}</span>
                    </div>
                  </div>
                {:else}
                  <div class="log-entry log-{log.source}">
                    <div class="d-flex w-100 justify-content-between">
                      <strong class="log-source">{log.source}</strong>
                      <small>{new Date(log.timestamp).toLocaleTimeString()}</small>
                    </div>
                    <span class="log-entry text-muted">{log.content}</span>
                  </div>
                {/if}
              {/each}
              {#if appState.geminiInterimTranscript}
                <div class="log-entry log-user interim">
                  <strong class="log-source">user</strong>
                  <span class="log-content">{appState.geminiInterimTranscript}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* Audio Meter Styles */
  .audio-levels {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .level-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9em;
  }
  .meter {
    flex: 1;
    height: 8px;
    background: #eee;
    border-radius: 4px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: #28a745;
    transition: width 0.1s ease;
  }

  /* Reasoning Path Log Styles */
  .reasoning-path-log {
    background-color: #f8f9fa;
    font-family: monospace;
    font-size: 0.9em;
  }
  .log-entry {
    padding: 4px 6px;
    border-bottom: 1px solid #eee;
    word-break: break-word;
    font-size: 0.9em;
  }
  .log-entry:last-child {
    border-bottom: none;
  }
  .log-source {
    font-weight: bold;
    margin-right: 8px;
    text-transform: capitalize;
    font-size: 1rem;
  }
  .log-user .log-source {
    color: #0d6efd;
  }
  .log-model .log-source {
    color: #198754;
  }
  .log-tool .log-source {
    color: #6c757d;
  }
  .log-entry.interim {
    opacity: 0.6;
  }

  /* Theme Overrides */
  :global(.theme-spaceship) .meter {
    background: #333;
  }
  :global(.theme-spaceship) .fill {
    background: #00ff00;
  }
  :global(.theme-spaceship) .reasoning-path-log {
    background-color: #073642;
    border-color: var(--hal-border) !important;
    font-family: "Orbitron", "Courier New", Courier, monospace;
  }
  :global(.theme-spaceship) .log-entry {
    border-bottom-color: #222;
  }
  :global(.theme-spaceship) .log-entry h6 {
    color: #d869b4;
    text-shadow: 0 0 5px #d869b4;
  }
  .log-entry h6 {
    color: #d869b4;
    text-shadow: 0 0 5px #d869b4;
  }
  :global(.theme-spaceship) .log-entry small {
    color: #87cefa;
    text-shadow: 0 0 3px #87cefa;
  }
  :global(.theme-spaceship) .log-user .log-source {
    color: #87cefa;
  }
  :global(.theme-spaceship) .log-model .log-source {
    color: #90cc90;
    text-shadow: 0 0 5px #90cc90;
  }

  :global(.theme-spaceship) .special-bg {
    background-color: #00251e; /* Dark Teal */
  }

  .spaceship-glow {
    text-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
  }

  /* Animations */
  @keyframes monitor-turn-on {
    0% { transform: scale(0.2, 0.002); opacity: 0; filter: brightness(0) contrast(2); }
    10% { transform: scale(0.2, 0.002); opacity: 1; filter: brightness(5) contrast(2); }
    40% { transform: scale(1, 0.002); filter: brightness(5) contrast(2); }
    70% { transform: scale(1, 1); filter: brightness(1.5) contrast(1.2); }
    100% { transform: scale(1, 1); filter: brightness(1) contrast(1); }
  }
  .monitor-turn-on {
    animation: monitor-turn-on 0.4s cubic-bezier(0.23, 1, 0.32, 1) forwards;
    transform-origin: center;
  }
  @keyframes blink-subtle {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .blink-subtle {
    animation: blink-subtle 3s infinite ease-in-out;
  }
</style>