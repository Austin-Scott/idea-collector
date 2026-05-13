<script setup lang="ts">
import { ArrowLeft, ArrowRight, Keyboard, Maximize2, Mic, Minimize2, MonitorCheck, Square, Sun, X } from "lucide-vue-next";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { autoNameProject, createProject, fetchSettings, fetchSnapshot, uploadIdeaAudio, type AppSettings } from "../api";
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreenActive,
  isWakeLockSupported,
  releaseScreenWakeLock,
  requestScreenWakeLock,
  type WakeLockState
} from "../device";
import {
  actionForCode,
  clearPedalBindings,
  defaultSelection,
  loadPedalBindings,
  moveSelection,
  savePedalBindings,
  selectedProjectStorageKey,
  selectionItems
} from "../pedals";
import { chooseAudioMimeType, stopStream } from "../recorder";
import { NEW_PROJECT_ID, type AppSnapshot, type PedalAction, type PedalBindings } from "../../shared/types";

const calibrationOrder: PedalAction[] = ["left", "center", "right"];
const touchControlsStorageKey = "idea-collector-show-touch-controls";

defineProps<{
  settingsOpen: boolean;
  currentView: "capture" | "review";
}>();

const emit = defineEmits<{
  "close-settings": [];
  navigate: [view: "capture" | "review"];
}>();

const snapshot = ref<AppSnapshot>({ projects: [], ideas: [] });
const settings = ref<AppSettings>({ transcriptionModel: "gpt-4o-transcribe", projectNameModel: "gpt-4o-mini", minRecordingMs: 650 });
const bindings = ref<PedalBindings | null>(loadPedalBindings());
const selectedProjectId = ref<string>(window.localStorage.getItem(selectedProjectStorageKey) ?? "");
const calibrationIndex = ref<number | null>(bindings.value ? null : 0);
const calibrationDraft = ref<Partial<PedalBindings>>({});
const recording = ref(false);
const status = ref("Ready");
const errorMessage = ref("");
const wakeLockState = ref<WakeLockState>(isWakeLockSupported() ? "released" : "unsupported");
const fullscreenActive = ref(isFullscreenActive());
const showTouchControls = ref(window.localStorage.getItem(touchControlsStorageKey) !== "false");
const projectButtons = new Map<string, HTMLElement>();

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: BlobPart[] = [];
let startedAt = 0;
let refreshTimer: number | undefined;
const inFlightAutoNames = new Set<string>();

const items = computed(() => selectionItems(snapshot.value.projects));
const selectedItem = computed(() => items.value.find((item) => item.id === selectedProjectId.value) ?? items.value[0]);
const selectedProjectThoughts = computed(() =>
  snapshot.value.ideas.filter((idea) => idea.projectId === selectedProjectId.value)
);
const recentSelectedThoughts = computed(() => selectedProjectThoughts.value.slice(-3).reverse());
const currentCalibrationAction = computed(() =>
  calibrationIndex.value === null ? null : calibrationOrder[calibrationIndex.value]
);

watch(
  () => snapshot.value.projects,
  (projects) => {
    selectedProjectId.value = defaultSelection(projects, selectedProjectId.value || window.localStorage.getItem(selectedProjectStorageKey));
  },
  { immediate: true }
);

watch(selectedProjectId, (projectId, previousProjectId) => {
  if (projectId) {
    window.localStorage.setItem(selectedProjectStorageKey, projectId);
  }
  void scrollSelectedProjectIntoView();
  if (previousProjectId && previousProjectId !== projectId) {
    void autoNameIfReady(previousProjectId);
  }
  syncStatusFromSnapshot();
});

watch(showTouchControls, (enabled) => {
  window.localStorage.setItem(touchControlsStorageKey, String(enabled));
});

onMounted(async () => {
  await Promise.all([refresh(), loadSettings()]);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("fullscreenchange", syncFullscreenState);
  refreshTimer = window.setInterval(refresh, 2500);
  await enableWakeLock();
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("fullscreenchange", syncFullscreenState);
  window.clearInterval(refreshTimer);
  stopStream(stream);
  void releaseScreenWakeLock();
});

async function loadSettings(): Promise<void> {
  try {
    settings.value = await fetchSettings();
  } catch (error) {
    setError(error);
  }
}

async function refresh(): Promise<void> {
  try {
    snapshot.value = await fetchSnapshot();
    syncStatusFromSnapshot();
    void autoNameDeselectedProjects();
    await scrollSelectedProjectIntoView();
  } catch (error) {
    setError(error);
  }
}

async function enableWakeLock(): Promise<void> {
  wakeLockState.value = await requestScreenWakeLock(() => {
    wakeLockState.value = "released";
  });
}

async function toggleWakeLock(): Promise<void> {
  if (wakeLockState.value === "active") {
    await releaseScreenWakeLock();
    wakeLockState.value = "released";
    return;
  }

  await enableWakeLock();
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreenActive()) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
    syncFullscreenState();
  } catch (error) {
    setError(error);
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible" && wakeLockState.value === "released") {
    void enableWakeLock();
  }
}

function syncFullscreenState(): void {
  fullscreenActive.value = isFullscreenActive();
}

function setProjectButtonRef(projectId: string, element: Element | null): void {
  if (element instanceof HTMLElement) {
    projectButtons.set(projectId, element);
  } else {
    projectButtons.delete(projectId);
  }
}

async function scrollSelectedProjectIntoView(): Promise<void> {
  await nextTick();
  projectButtons.get(selectedProjectId.value)?.scrollIntoView({
    block: "nearest",
    inline: "center",
    behavior: "smooth"
  });
}

function selectProject(projectId: string): void {
  selectedProjectId.value = projectId;
}

function syncStatusFromSnapshot(): void {
  if (recording.value || calibrationIndex.value !== null || errorMessage.value) {
    return;
  }

  if (selectedProjectId.value === NEW_PROJECT_ID) {
    status.value = "Ready";
    return;
  }

  const latestThought = [...selectedProjectThoughts.value].reverse()[0];
  if (!latestThought) {
    status.value = "Ready";
    return;
  }

  if (latestThought.status === "ready") {
    status.value = "Thought transcribed";
  } else if (latestThought.status === "failed") {
    status.value = "Transcription failed";
  } else if (latestThought.status === "transcribing") {
    status.value = "Transcribing thought";
  } else {
    status.value = "Queued for transcription";
  }
}

function autoNameDeselectedProjects(): void {
  for (const project of snapshot.value.projects) {
    if (project.id !== selectedProjectId.value) {
      void autoNameIfReady(project.id);
    }
  }
}

async function autoNameIfReady(projectId: string): Promise<void> {
  if (projectId === NEW_PROJECT_ID || inFlightAutoNames.has(projectId)) {
    return;
  }

  const project = snapshot.value.projects.find((candidate) => candidate.id === projectId);
  if (!project || project.nameLocked) {
    return;
  }

  const hasReadyThoughts = snapshot.value.ideas.some(
    (idea) => idea.projectId === projectId && idea.status === "ready" && idea.transcript?.trim()
  );
  if (!hasReadyThoughts) {
    return;
  }

  inFlightAutoNames.add(projectId);
  try {
    const updated = await autoNameProject(projectId);
    snapshot.value = {
      ...snapshot.value,
      projects: snapshot.value.projects.map((candidate) => candidate.id === updated.id ? updated : candidate)
    };
  } catch (error) {
    console.warn("Project auto-name failed", error);
  } finally {
    inFlightAutoNames.delete(projectId);
  }
}

function startCalibration(): void {
  clearPedalBindings();
  bindings.value = null;
  calibrationDraft.value = {};
  calibrationIndex.value = 0;
  status.value = "Calibration active";
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.repeat) {
    return;
  }

  if (calibrationIndex.value !== null) {
    captureCalibrationKey(event);
    return;
  }

  const action = actionForCode(event.code, bindings.value);
  if (!action) {
    return;
  }

  event.preventDefault();

  if (action === "left" && !recording.value) {
    selectProject(moveSelection(selectedProjectId.value, items.value, -1));
    return;
  }

  if (action === "right" && !recording.value) {
    selectProject(moveSelection(selectedProjectId.value, items.value, 1));
    return;
  }

  if (action === "center" && !recording.value) {
    void beginRecording();
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  const action = actionForCode(event.code, bindings.value);
  if (action !== "center" || !recording.value) {
    return;
  }

  event.preventDefault();
  stopRecording();
}

function captureCalibrationKey(event: KeyboardEvent): void {
  const action = currentCalibrationAction.value;
  if (!action) {
    return;
  }

  event.preventDefault();
  calibrationDraft.value = {
    ...calibrationDraft.value,
    [action]: event.code
  };

  const nextIndex = (calibrationIndex.value ?? 0) + 1;
  if (nextIndex >= calibrationOrder.length) {
    const nextBindings = calibrationDraft.value as PedalBindings;
    bindings.value = nextBindings;
    savePedalBindings(nextBindings);
    calibrationIndex.value = null;
    status.value = "Pedals calibrated";
    return;
  }

  calibrationIndex.value = nextIndex;
}

async function beginRecording(): Promise<void> {
  try {
    errorMessage.value = "";
    let projectId = selectedProjectId.value;
    if (projectId === NEW_PROJECT_ID) {
      const project = await createProject();
      await refresh();
      selectedProjectId.value = project.id;
      projectId = project.id;
    }

    const audioMimeType = chooseAudioMimeType();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    recorder = new MediaRecorder(stream, audioMimeType ? { mimeType: audioMimeType } : undefined);
    chunks = [];
    startedAt = performance.now();
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      void finishRecording(projectId, recorder?.mimeType || audioMimeType || "application/octet-stream");
    });

    recorder.start();
    recording.value = true;
    status.value = `Recording: ${selectedItem.value?.label ?? "Project"}`;
  } catch (error) {
    recording.value = false;
    stopStream(stream);
    stream = null;
    setError(error);
  }
}

function stopRecording(): void {
  if (!recorder || recorder.state === "inactive") {
    return;
  }

  status.value = "Saving recording";
  recorder.stop();
}

async function finishRecording(projectId: string, mimeType: string): Promise<void> {
  const durationMs = performance.now() - startedAt;
  const blob = new Blob(chunks, { type: mimeType });

  recording.value = false;
  recorder = null;
  stopStream(stream);
  stream = null;

  if (durationMs < settings.value.minRecordingMs || blob.size === 0) {
    status.value = "Discarded short press";
    return;
  }

  try {
    await uploadIdeaAudio({ projectId, blob, durationMs, mimeType });
    status.value = "Transcribing thought";
    await refresh();
  } catch (error) {
    setError(error);
  }
}

function setError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : String(error);
  status.value = "Needs attention";
}
</script>

<template>
  <section class="capture-layout">
    <div class="capture-status" :class="{ recording }">
      <div>
        <span class="status-label">{{ status }}</span>
        <h2>{{ selectedItem?.label ?? "No project" }}</h2>
      </div>
      <div class="recording-indicator" aria-live="polite">
        <Mic v-if="recording" :size="28" aria-hidden="true" />
        <Square v-else :size="26" aria-hidden="true" />
      </div>
    </div>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">
      {{ errorMessage }}
    </div>

    <div class="project-strip" aria-label="Project selection">
      <button
        v-for="item in items"
        :key="item.id"
        :ref="(element) => setProjectButtonRef(item.id, element as Element | null)"
        type="button"
        class="project-chip"
        :class="{ active: item.id === selectedProjectId, new: item.isNewProject }"
        @click="selectProject(item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div v-if="showTouchControls" class="pedal-panel">
      <button type="button" class="pedal-button" :disabled="recording" @click="selectProject(moveSelection(selectedProjectId, items, -1))">
        <ArrowLeft :size="28" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="pedal-button pedal-button-center"
        :class="{ recording }"
        @pointerdown.prevent="beginRecording"
        @pointerup.prevent="stopRecording"
        @pointercancel.prevent="stopRecording"
      >
        <Mic v-if="!recording" :size="32" aria-hidden="true" />
        <Square v-else :size="32" aria-hidden="true" />
      </button>
      <button type="button" class="pedal-button" :disabled="recording" @click="selectProject(moveSelection(selectedProjectId, items, 1))">
        <ArrowRight :size="28" aria-hidden="true" />
      </button>
    </div>

    <div v-if="calibrationIndex !== null" class="alert alert-info calibration-callout" role="status">
      Press {{ currentCalibrationAction }} pedal
    </div>

    <section class="recent-panel compact-recent-panel">
      <h3>Recent Thoughts</h3>
      <div v-if="recentSelectedThoughts.length === 0" class="empty-state">No thoughts yet.</div>
      <article v-for="thought in recentSelectedThoughts" :key="thought.id" class="idea-row">
        <span class="badge" :class="`text-bg-${thought.status === 'ready' ? 'success' : thought.status === 'failed' ? 'danger' : 'warning'}`">
          {{ thought.status }}
        </span>
        <p>{{ thought.transcript || thought.error || "Transcription pending" }}</p>
      </article>
    </section>

    <div v-if="settingsOpen" class="modal-layer" role="presentation" @click.self="emit('close-settings')">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="capture-settings-title">
        <header class="modal-header-row">
          <h2 id="capture-settings-title">Settings</h2>
          <button type="button" class="btn btn-outline-secondary icon-only-button" aria-label="Close settings" @click="emit('close-settings')">
            <X :size="18" aria-hidden="true" />
          </button>
        </header>

        <div class="settings-group">
          <span class="settings-label">View</span>
          <div class="settings-button-grid">
            <button type="button" class="btn btn-primary" @click="emit('navigate', 'capture')">
              <Mic :size="17" aria-hidden="true" />
              Capture
            </button>
            <button type="button" class="btn btn-outline-primary" @click="emit('navigate', 'review')">
              <MonitorCheck :size="17" aria-hidden="true" />
              Review
            </button>
          </div>
        </div>

        <div class="settings-group">
          <span class="settings-label">Phone</span>
          <div class="settings-button-grid">
            <button
              type="button"
              class="btn"
              :class="wakeLockState === 'active' ? 'btn-primary' : 'btn-outline-secondary'"
              :disabled="wakeLockState === 'unsupported'"
              @click="toggleWakeLock"
            >
              <Sun :size="17" aria-hidden="true" />
              {{ wakeLockState === "active" ? "Awake On" : wakeLockState === "unsupported" ? "Awake Unsupported" : "Keep Awake" }}
            </button>
            <button type="button" class="btn btn-outline-primary" @click="toggleFullscreen">
              <Minimize2 v-if="fullscreenActive" :size="17" aria-hidden="true" />
              <Maximize2 v-else :size="17" aria-hidden="true" />
              {{ fullscreenActive ? "Exit Fullscreen" : "Fullscreen" }}
            </button>
          </div>
        </div>

        <div class="settings-group">
          <span class="settings-label">Pedals</span>
          <div class="settings-summary">
            <span v-if="bindings">{{ bindings.left }} / {{ bindings.center }} / {{ bindings.right }}</span>
            <span v-else>Uncalibrated</span>
          </div>
          <button type="button" class="btn btn-outline-secondary" @click="startCalibration">
            <Keyboard :size="16" aria-hidden="true" />
            Calibrate
          </button>
          <div v-if="calibrationIndex !== null" class="alert alert-info calibration-callout" role="status">
            Press {{ currentCalibrationAction }} pedal
          </div>
        </div>

        <label class="toggle-row">
          <input v-model="showTouchControls" type="checkbox" />
          <span>Show on-screen touch controls</span>
        </label>
      </section>
    </div>
  </section>
</template>
