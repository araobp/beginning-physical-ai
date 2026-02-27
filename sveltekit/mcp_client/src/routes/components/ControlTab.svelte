<script lang="ts">
  import type { AppState } from "../state.svelte";
  import { getColorForObject, getTextColor } from "$lib/utils";

  let { appState }: { appState: AppState } = $props();
</script>

<div class="d-flex flex-column align-items-center mt-2">
  <!-- Control Panel -->
  <div class="d-flex flex-column gap-2 mb-2 w-100 align-items-center">
    <div class="d-flex gap-2 flex-wrap justify-content-center">
      <div class="border rounded p-2 d-flex gap-2 align-items-center bg-light shadow-sm">
        <button class="btn {appState.ppLive ? 'btn-danger' : 'btn-outline-danger'} btn-sm"
          onclick={() => appState.toggleLive()}
          class:spaceship-glow={appState.currentTheme === 'spaceship' && appState.ppLive}
        >
          {appState.ppLive ? appState.t.stop_live : appState.t.live}
        </button>
        <div class="vr mx-1"></div>
        <button class="btn btn-secondary btn-sm" onclick={() => appState.clearPPPoints()} disabled={appState.ppExecuting}>
          {appState.t.clear}
        </button>
        <button class="btn btn-success btn-sm" onclick={() => appState.runPickAndPlace()} disabled={!appState.ppPickPoint || !appState.ppPlacePoint || appState.ppExecuting}>
          {appState.ppExecuting ? appState.t.running : appState.t.pick_place}
        </button>
      </div>
      <div class="border rounded p-2 d-flex gap-3 align-items-center bg-light shadow-sm flex-wrap justify-content-center">
        <div class="form-check form-switch mb-0">
          <input class="form-check-input" type="checkbox" role="switch" id="ppShowDetectionsSwitch" bind:checked={appState.ppShowDetections} />
          <label class="form-check-label" for="ppShowDetectionsSwitch">{appState.t.show_detections}</label>
        </div>
        <div class="input-group input-group-sm" style="width: auto;">
          <span class="input-group-text">{appState.t.confidence}</span>
          <input type="number" class="form-control" style="width: 65px;" bind:value={appState.detectionConfidence} min="0.1" max="1.0" step="0.1" disabled={!appState.ppShowDetections} />
        </div>
      </div>
    </div>
    <div class="d-flex gap-2 flex-wrap justify-content-center">
      <div class="border rounded p-2 d-flex gap-3 align-items-center bg-light shadow-sm flex-wrap justify-content-center">
        <div class="form-check form-switch mb-0">
          <input class="form-check-input" type="checkbox" role="switch" id="ppShowTrajectorySwitch" bind:checked={appState.ppShowTrajectory} />
          <label class="form-check-label" for="ppShowTrajectorySwitch">{appState.t.show_trajectory}</label>
        </div>
        <div class="input-group input-group-sm" style="width: auto;">
          <span class="input-group-text px-1">Pick Z</span>
          <input type="number" class="form-control px-1" style="width: 65px;" bind:value={appState.ppPickZ} />
          <span class="input-group-text px-1">Place Z</span>
          <input type="number" class="form-control px-1" style="width: 65px;" bind:value={appState.ppPlaceZ} />
          <span class="input-group-text px-1">Safe Z</span>
          <input type="number" class="form-control px-1" style="width: 65px;" bind:value={appState.ppSafetyZ} />
        </div>
      </div>
    </div>
  </div>

  {#if appState.ppImage}
    <div class="position-relative d-inline-block" onmousemove={(e) => appState.handlePPMouseMove(e)} onmouseleave={() => appState.handlePPMouseLeave()} role="group">
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <img src={appState.ppImage} alt="Pick & Place View" class="img-fluid border rounded" style="max-height: 440px; cursor: crosshair;" onclick={(e) => appState.handlePPImageClick(e)} onload={(e) => { const img = e.currentTarget as HTMLImageElement; appState.ppImageDim = { w: img.naturalWidth, h: img.naturalHeight }; }} />

      {#if appState.ppShowDetections}
        {#each appState.ppDetections as obj}
          {@const color = getColorForObject(obj)}
          <div style="position: absolute; left: {obj.box_2d[1] / 10}%; top: {obj.box_2d[0] / 10}%; width: {(obj.box_2d[3] - obj.box_2d[1]) / 10}%; height: {(obj.box_2d[2] - obj.box_2d[0]) / 10}%; border: 2px solid {color}; pointer-events: none; z-index: 5;">
            <span style="background: {color}; color: {getTextColor(color)}; position: absolute; top: -1.5em; left: 0; padding: 0 2px; font-size: 0.8em; white-space: nowrap;">
              {obj.label}{appState.ppHoveredObject === obj && obj.color_name ? ` (${obj.color_name})` : ""}
            </span>
          </div>
          {#if obj.ground_center && !Array.isArray(obj.ground_center)}
            {@const groundContactX = obj.ground_center.u_norm / 10}
            {@const groundContactY = obj.ground_center.v_norm / 10}
            {#if obj.label.endsWith("_ok") && obj.ground_center.radius_u_norm}
              <div
                style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: {(obj.ground_center.radius_u_norm / 10) * 2}%; height: {(obj.ground_center.radius_v_norm / 10) * 2}%; border: 1px dashed {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5; opacity: 0.7;"
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
      {/if}

      {#if appState.ppShowTrajectory && appState.ppTrajectoryPoints.length > 0 && appState.ppImageDim}
        <svg viewBox="0 0 {appState.ppImageDim.w} {appState.ppImageDim.h}" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4;">
          <polyline points={appState.ppTrajectoryPoints.map((p) => `${p.u},${p.v}`).join(" ")} fill="none" stroke="deeppink" stroke-width="3" stroke-dasharray="5,5" />
          {#each appState.ppTrajectoryPoints as p}
            <circle cx={p.u} cy={p.v} r="3" fill="deeppink" />
          {/each}
        </svg>
      {/if}

      {#if appState.ppPickPoint}
        {@const pt = appState.ppPickPoint}
        <div style="position: absolute; left: {pt.u_norm * 100}%; top: {pt.v_norm * 100}%; transform: translate(-50%, -50%); pointer-events: none;">
          <div style="width: 10px; height: 10px; background: purple; border-radius: 50%;"></div>
          <div style="position: absolute; top: -10px; left: 15px; background: rgba(0,0,0,0.5); color: white; padding: 4px; border-radius: 4px; font-size: 0.8em; white-space: nowrap;">
            <div>Pick</div>
          </div>
        </div>
      {/if}

      {#if appState.ppPlacePoint}
        {@const pt = appState.ppPlacePoint}
        <div style="position: absolute; left: {pt.u_norm * 100}%; top: {pt.v_norm * 100}%; transform: translate(-50%, -50%); pointer-events: none;">
          <div style="width: 10px; height: 10px; background: blue; border-radius: 50%;"></div>
          <div style="position: absolute; top: -10px; left: 15px; background: rgba(0,0,0,0.5); color: white; padding: 4px; border-radius: 4px; font-size: 0.8em; white-space: nowrap;">
            <div>Place</div>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="text-muted p-5 border rounded bg-light">
      {appState.t.click_live}
    </div>
  {/if}

  <!-- Joypad Visualization -->
  <div class="d-flex flex-column align-items-center mt-1 mb-1 p-1 border rounded bg-light">
    <div class="d-flex gap-4 justify-content-center">
      <div class="joypad-stick">
        <div class="stick-label">{appState.t.joypad_left}</div>
        <div class="stick-base">
          <div class="stick-knob" style="transform: translate({appState.joypadLeft.x}px, {appState.joypadLeft.y}px)"></div>
        </div>
      </div>
      <div class="joypad-stick">
        <div class="stick-label">{appState.t.joypad_right}</div>
        <div class="stick-base">
          <div class="stick-knob" style="transform: translate({appState.joypadRight.x}px, {appState.joypadRight.y}px)"></div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .joypad-stick {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .stick-label {
    font-size: 0.8rem;
    margin-bottom: 5px;
    font-weight: bold;
  }
  .stick-base {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background-color: #ddd;
    border: 2px solid #bbb;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .stick-knob {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: #555;
    transition: transform 0.2s ease;
  }

  :global(.theme-spaceship) .stick-base {
    background-color: #222;
    border-color: #444;
  }
  :global(.theme-spaceship) .stick-knob {
    background-color: var(--hal-red, #ff2d2d);
  }

  .spaceship-glow {
    text-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
  }
</style>