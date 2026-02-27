<script lang="ts">
  import type { AppState } from "../state.svelte";
  import { getColorForObject, getTextColor } from "$lib/utils";

  let { appState }: { appState: AppState } = $props();
</script>

<div class="container-fluid mt-1 mb-1">
  <div class="row mb-3">
    <div class="col-12 d-flex align-items-center gap-3">
      <button class="btn {appState.cliMonitor ? 'btn-danger' : 'btn-outline-danger'}"
        onclick={() => appState.toggleCliMonitor()}
        class:spaceship-glow={appState.currentTheme === 'spaceship' && appState.cliMonitor}
      >
        {appState.cliMonitor ? appState.t.stop_live : appState.t.live}
      </button>
      <span class="text-muted">{appState.t.gemini_monitor_desc}</span>
    </div>
  </div>
  <div class="row">
    <!-- Left: Live Monitor -->
    <div class="col-md-6">
      <div class="card">
        <div class="card-header">Live Monitor</div>
        <div
          class="card-body text-center p-0 bg-dark position-relative d-flex align-items-center justify-content-center"
          style="height: 350px; overflow: hidden;"
        >
          {#if appState.cliMonitor}
            <img
              src={appState.cliMonitorImageSrc}
              alt="Gemini Monitor View"
              class="img-fluid"
              class:monitor-turn-on={appState.cliMonitorLoaded}
              class:opacity-0={!appState.cliMonitorLoaded}
              style="max-height: 100%; max-width: 100%;"
              onload={(e) => {
                appState.cliMonitorLoaded = true;
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
    </div>

    <!-- Right: Tool Logs -->
    <div class="col-md-6">
      <div class="card" style="height: 440px;">
        <div class="card-header">Tool Execution Log</div>
        <div
          class="card-body overflow-auto p-0"
          class:reasoning-path-bg={appState.cliMonitor}
          class:log-offline-bg={!appState.cliMonitor}
        >
          <div class="list-group list-group-flush" >
            {#each appState.geminiLogs as log}
              <div class="list-group-item">
                <div class="d-flex w-100 justify-content-between">
                  <h6 class="mb-1">{log.tool}</h6>
                  <small>{new Date(
                      log.timestamp * 1000,
                    ).toLocaleTimeString()}</small
                  >
                </div>
                <div class="mb-1 small">
                  <strong>Args:</strong>
                  <span class="text-muted text-break"
                    >{JSON.stringify(log.args)}</span
                  >
                </div>
                <div class="small">
                  <strong>Result:</strong>
                  <span class="text-muted text-break">{log.result}</span>
                </div>
              </div>
            {/each}
            {#if appState.geminiLogs.length === 0}
              <div class="p-3 text-center text-muted">
                No logs available
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .log-offline-bg {
    background-color: #f8f9fa;
  }
  :global(.theme-spaceship) .log-offline-bg {
    background-color: #00251e; /* Dark Teal from GeminiLiveTab's special-bg */
  }

  .reasoning-path-bg {
    background-color: #f8f9fa; /* from GeminiLiveTab reasoning-path-log */
  }
  :global(.theme-spaceship) .reasoning-path-bg {
    background-color: #073642; /* from GeminiLiveTab reasoning-path-log */
  }

  .reasoning-path-bg .list-group-item, .log-offline-bg .list-group-item {
    background-color: transparent;
    border-bottom-color: #eee; /* from GeminiLiveTab log-entry */
  }
  :global(.theme-spaceship) .reasoning-path-bg .list-group-item, :global(.theme-spaceship) .log-offline-bg .list-group-item {
    border-bottom-color: #222;
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
