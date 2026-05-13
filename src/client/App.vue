<script setup lang="ts">
import { Settings } from "lucide-vue-next";
import { onMounted, onUnmounted, ref } from "vue";
import CaptureView from "./components/CaptureView.vue";
import ReviewView from "./components/ReviewView.vue";

export type ViewName = "capture" | "review";

const currentView = ref<ViewName>(viewFromHash());
const settingsOpen = ref(false);

function setView(view: ViewName): void {
  currentView.value = view;
  window.location.hash = view === "review" ? "#/review" : "#/";
  settingsOpen.value = false;
}

function syncHash(): void {
  currentView.value = viewFromHash();
}

function viewFromHash(): ViewName {
  return window.location.hash === "#/review" ? "review" : "capture";
}

onMounted(() => window.addEventListener("hashchange", syncHash));
onUnmounted(() => window.removeEventListener("hashchange", syncHash));
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <h1>Idea Collector</h1>
        <span class="app-subtitle">Foot-pedal capture for Codex project thoughts</span>
      </div>
      <button type="button" class="btn btn-outline-secondary icon-button" @click="settingsOpen = true">
        <Settings :size="18" aria-hidden="true" />
        Settings
      </button>
    </header>

    <main>
      <CaptureView
        v-if="currentView === 'capture'"
        :settings-open="settingsOpen"
        :current-view="currentView"
        @close-settings="settingsOpen = false"
        @navigate="setView"
      />
      <ReviewView
        v-else
        :settings-open="settingsOpen"
        :current-view="currentView"
        @close-settings="settingsOpen = false"
        @navigate="setView"
      />
    </main>
  </div>
</template>
