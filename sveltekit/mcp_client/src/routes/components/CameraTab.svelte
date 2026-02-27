<script lang="ts">
  import type { AppState } from "../state.svelte";
  import { getColorForObject } from "$lib/utils";
  
  let { appState }: { appState: AppState } = $props();

  function handleImageClick(event: MouseEvent & { currentTarget: HTMLImageElement }) {
    const img = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let u = Math.floor(x * (img.naturalWidth / rect.width));
    let v = Math.floor(y * (img.naturalHeight / rect.height));

    u = Math.max(0, Math.min(u, img.naturalWidth - 1));
    v = Math.max(0, Math.min(v, img.naturalHeight - 1));

    appState.targetMarker = { x, y };
    appState.targetImageCoords = { u, v };
    appState.targetWorldCoords = null;

    appState.convertImageCoordsToWorld(u, v);
  }
</script>

<div class="d-flex flex-column align-items-center mt-3">
  <div class="mb-3 d-flex gap-2 align-items-center">
    <select class="form-select w-auto" bind:value={appState.detectionModel}>
      <option value="yolo11n">yolo11n</option>
      <option value="tensorflow.js">tensorflow.js</option>
      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
      <option value="gemini-robotics-er-1.5-preview">gemini-robotics-er-1.5-preview</option>
    </select>
    <div class="form-check">
      <input
        class="form-check-input"
        type="checkbox"
        id="visualizeAxesCheck"
        bind:checked={appState.visualizeAxes}
      />
      <label class="form-check-label" for="visualizeAxesCheck">Axes</label>
    </div>
    <div class="input-group input-group-sm" style="width: auto;">
      <span class="input-group-text">{appState.t.confidence}</span>
      <input
        type="number"
        class="form-control"
        style="width: 80px;"
        bind:value={appState.detectionConfidence}
        min="0.1"
        max="1.0"
        step="0.1"
      />
    </div>
    <button
      class="btn btn-primary"
      onclick={() => appState.captureImage()}
      disabled={appState.capturing}
    >
      {appState.capturing ? appState.t.capturing : appState.t.capture}
    </button>
    <button
      class="btn btn-primary"
      onclick={() => appState.detectObjects()}
      disabled={appState.detecting || (appState.detectionModel === "tensorflow.js" && !appState.tfReady)}
    >
      {#if appState.detecting}{appState.t.detecting}
      {:else if appState.detectionModel === "tensorflow.js" && !appState.tfReady}Loading TF.js...
      {:else}{appState.t.detect}{/if}
    </button>
  </div>
  {#if appState.cameraImage}
    <div class="position-relative d-inline-block">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <img
        src={appState.cameraImage}
        alt="Robot Camera View"
        class="img-fluid border rounded"
        style="max-height: 440px; cursor: crosshair;"
        onclick={handleImageClick}
      />
      {#each appState.detectedObjects as obj}
        {@const color = getColorForObject(obj)}
        <div
          style="position: absolute; left: {obj.box_2d[1] / 10}%; top: {obj.box_2d[0] / 10}%; width: {(obj.box_2d[3] - obj.box_2d[1]) / 10}%; height: {(obj.box_2d[2] - obj.box_2d[0]) / 10}%; border: 2px solid {color}; pointer-events: none; z-index: 5;"
        >
          <span style="background: {color}; color: white; position: absolute; top: -1.5em; left: 0; padding: 0 2px; font-size: 0.8em;">{obj.label}</span>
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
        {:else if obj.ground_center && Array.isArray(obj.ground_center)}
          <div
            style="position: absolute; left: {obj.ground_center[1] / 10}%; top: {obj.ground_center[0] / 10}%; width: 10px; height: 10px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 6;"
          ></div>
        {/if}
      {/each}
      {#if appState.targetMarker}
        <div style="position: absolute; left: {appState.targetMarker.x}px; top: {appState.targetMarker.y}px; width: 0; height: 0; pointer-events: none;">
            <div style="position: absolute; width: 20px; height: 20px; border: 2px solid red; border-radius: 50%; transform: translate(-50%, -50%);"></div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="text-muted p-5 border rounded bg-light">
      {appState.t.no_image}
    </div>
  {/if}
</div>