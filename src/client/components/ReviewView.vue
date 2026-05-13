<script setup lang="ts">
import { AlertTriangle, Clipboard, Download, Mic, QrCode, RefreshCw, RotateCcw, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { deleteIdea, deleteProject, exportIdeas, fetchConnectInfo, fetchSnapshot, renameProject, retryIdea, type ConnectInfo } from "../api";
import type { AppSnapshot, IdeaRecord, ProjectRecord } from "../../shared/types";

const snapshot = ref<AppSnapshot>({ projects: [], ideas: [] });
const draftNames = reactive<Record<string, string>>({});
const status = ref("Ready");
const errorMessage = ref("");
const exportedMarkdown = ref("");
const connectInfo = ref<ConnectInfo | null>(null);
const projectPendingDeletion = ref<ProjectRecord | null>(null);
const deletingProject = ref(false);
const deletingThoughtIds = ref<Set<string>>(new Set());
const dirtyProjectNames = new Set<string>();
let refreshTimer: number | undefined;

defineProps<{
  settingsOpen: boolean;
  currentView: "capture" | "review";
}>();

const emit = defineEmits<{
  "close-settings": [];
  navigate: [view: "capture" | "review"];
}>();

const ideasByProject = computed(() => {
  const groups = new Map<string, IdeaRecord[]>();
  for (const idea of snapshot.value.ideas) {
    const ideas = groups.get(idea.projectId) ?? [];
    ideas.push(idea);
    groups.set(idea.projectId, ideas);
  }
  return groups;
});

const readyUnexportedCount = computed(
  () => snapshot.value.ideas.filter((idea) => idea.status === "ready" && !idea.exportedAt).length
);
const deletionThoughtCount = computed(() =>
  projectPendingDeletion.value ? (ideasByProject.value.get(projectPendingDeletion.value.id) ?? []).length : 0
);

onMounted(async () => {
  await Promise.all([refresh(), loadConnectInfo()]);
  refreshTimer = window.setInterval(refresh, 3000);
});

onUnmounted(() => window.clearInterval(refreshTimer));

async function refresh(): Promise<void> {
  try {
    snapshot.value = await fetchSnapshot();
    for (const project of snapshot.value.projects) {
      if (!dirtyProjectNames.has(project.id)) {
        draftNames[project.id] = project.name;
      }
    }
  } catch (error) {
    setError(error);
  }
}

async function loadConnectInfo(): Promise<void> {
  try {
    connectInfo.value = await fetchConnectInfo();
  } catch (error) {
    setError(error);
  }
}

async function saveName(project: ProjectRecord): Promise<void> {
  try {
    const name = draftNames[project.id]?.trim();
    if (!name || name === project.name) {
      draftNames[project.id] = project.name;
      dirtyProjectNames.delete(project.id);
      return;
    }
    const updated = await renameProject(project.id, name);
    draftNames[project.id] = updated.name;
    dirtyProjectNames.delete(project.id);
    status.value = "Project renamed";
    await refresh();
  } catch (error) {
    setError(error);
  }
}

async function retry(ideaId: string): Promise<void> {
  try {
    await retryIdea(ideaId);
    status.value = "Retry queued";
    await refresh();
  } catch (error) {
    setError(error);
  }
}

async function deleteThought(ideaId: string): Promise<void> {
  if (deletingThoughtIds.value.has(ideaId)) {
    return;
  }

  deletingThoughtIds.value = new Set([...deletingThoughtIds.value, ideaId]);
  try {
    await deleteIdea(ideaId);
    await refresh();
    status.value = "Deleted thought";
  } catch (error) {
    setError(error);
  } finally {
    const nextIds = new Set(deletingThoughtIds.value);
    nextIds.delete(ideaId);
    deletingThoughtIds.value = nextIds;
  }
}

async function confirmDeleteProject(): Promise<void> {
  const project = projectPendingDeletion.value;
  if (!project) {
    return;
  }

  try {
    deletingProject.value = true;
    const result = await deleteProject(project.id);
    delete draftNames[project.id];
    dirtyProjectNames.delete(project.id);
    projectPendingDeletion.value = null;
    status.value = `Deleted project and ${result.deletedThoughtIds.length} thoughts`;
    await refresh();
  } catch (error) {
    setError(error);
  } finally {
    deletingProject.value = false;
  }
}

async function exportScope(projectId?: string): Promise<void> {
  try {
    const result = await exportIdeas({ projectId });
    exportedMarkdown.value = result.markdown;
    status.value = `Exported ${result.exportedThoughtIds.length} thoughts`;
    await refresh();
  } catch (error) {
    setError(error);
  }
}

async function copyExport(): Promise<void> {
  try {
    if (!exportedMarkdown.value) {
      const result = await exportIdeas({});
      exportedMarkdown.value = result.markdown;
      await refresh();
    }
    await navigator.clipboard.writeText(exportedMarkdown.value);
    status.value = "Copied export text";
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
  <section class="review-layout">
    <div class="connect-panel">
      <div class="connect-copy">
        <div class="connect-title">
          <QrCode :size="22" aria-hidden="true" />
          <h2>Connect Phone</h2>
        </div>
        <p>Scan this from Firefox on Android to open the current capture session.</p>
        <code v-if="connectInfo">{{ connectInfo.phoneUrl }}</code>
      </div>
      <div class="qr-frame">
        <img v-if="connectInfo" :src="connectInfo.qrPath" alt="QR code for the phone capture URL" />
        <span v-else>Loading QR</span>
      </div>
    </div>

    <div class="review-toolbar">
      <div>
        <h2>Review Queue</h2>
        <span class="text-muted">{{ readyUnexportedCount }} ready thoughts not exported</span>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="btn btn-outline-secondary" @click="refresh">
          <RefreshCw :size="17" aria-hidden="true" />
          Refresh
        </button>
        <button type="button" class="btn btn-outline-primary" @click="copyExport">
          <Clipboard :size="17" aria-hidden="true" />
          Copy
        </button>
        <button type="button" class="btn btn-primary" @click="exportScope()">
          <Download :size="17" aria-hidden="true" />
          Export
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">
      {{ errorMessage }}
    </div>
    <div class="alert alert-secondary py-2" role="status">{{ status }}</div>

    <article v-for="project in snapshot.projects" :key="project.id" class="project-review">
      <header>
        <input
          v-model="draftNames[project.id]"
          class="form-control project-name-input"
          :aria-label="`Project name for ${project.name}`"
          @input="dirtyProjectNames.add(project.id)"
          @change="saveName(project)"
          @blur="saveName(project)"
        />
        <div class="project-actions">
          <button type="button" class="btn btn-outline-primary btn-sm" @click="exportScope(project.id)">
            <Download :size="16" aria-hidden="true" />
            Export project
          </button>
          <button type="button" class="btn btn-outline-danger btn-sm" @click="projectPendingDeletion = project">
            <Trash2 :size="16" aria-hidden="true" />
            Delete
          </button>
        </div>
      </header>

      <div v-if="(ideasByProject.get(project.id) ?? []).length === 0" class="empty-state">
        No thoughts yet.
      </div>

      <div v-else class="table-responsive">
        <table class="table align-middle">
          <thead>
            <tr>
              <th>Status</th>
              <th>Thought</th>
              <th>Recorded</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="idea in ideasByProject.get(project.id)" :key="idea.id">
              <td>
                <span class="badge" :class="`text-bg-${idea.status === 'ready' ? 'success' : idea.status === 'failed' ? 'danger' : 'warning'}`">
                  {{ idea.status }}
                </span>
              </td>
              <td class="idea-text">
                {{ idea.transcript || idea.error || "Transcription pending" }}
              </td>
              <td>{{ new Date(idea.createdAt).toLocaleString() }}</td>
              <td class="text-end">
                <div class="thought-actions">
                  <button
                    v-if="idea.status === 'failed'"
                    type="button"
                    class="btn btn-outline-secondary btn-sm"
                    @click="retry(idea.id)"
                  >
                    <RotateCcw :size="16" aria-hidden="true" />
                    Retry
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline-danger btn-sm review-thought-delete-button"
                    :aria-label="`Delete thought recorded ${new Date(idea.createdAt).toLocaleString()}`"
                    title="Delete thought"
                    :disabled="deletingThoughtIds.has(idea.id)"
                    @click="deleteThought(idea.id)"
                  >
                    <X :size="16" aria-hidden="true" />
                    {{ deletingThoughtIds.has(idea.id) ? "Deleting" : "Delete thought" }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <div v-if="settingsOpen" class="modal-layer" role="presentation" @click.self="emit('close-settings')">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="review-settings-title">
        <header class="modal-header-row">
          <h2 id="review-settings-title">Settings</h2>
          <button type="button" class="btn btn-outline-secondary icon-only-button" aria-label="Close settings" @click="emit('close-settings')">
            <X :size="18" aria-hidden="true" />
          </button>
        </header>

        <div class="settings-group">
          <span class="settings-label">View</span>
          <div class="settings-button-grid">
            <button type="button" class="btn btn-outline-primary" @click="emit('navigate', 'capture')">
              <Mic :size="17" aria-hidden="true" />
              Capture
            </button>
            <button type="button" class="btn btn-primary" @click="emit('navigate', 'review')">
              <QrCode :size="17" aria-hidden="true" />
              Review
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="projectPendingDeletion" class="modal-layer" role="presentation" @click.self="projectPendingDeletion = null">
      <section class="settings-modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
        <header class="modal-header-row">
          <div class="delete-title">
            <AlertTriangle :size="22" aria-hidden="true" />
            <h2 id="delete-project-title">Delete Project</h2>
          </div>
          <button
            type="button"
            class="btn btn-outline-secondary icon-only-button"
            aria-label="Cancel delete project"
            :disabled="deletingProject"
            @click="projectPendingDeletion = null"
          >
            <X :size="18" aria-hidden="true" />
          </button>
        </header>

        <p>
          Delete <strong>{{ projectPendingDeletion.name }}</strong> and
          {{ deletionThoughtCount }} {{ deletionThoughtCount === 1 ? "thought" : "thoughts" }}?
        </p>
        <p class="text-muted">This removes the project from the dashboard and deletes its stored audio/transcription records.</p>

        <div class="confirm-actions">
          <button type="button" class="btn btn-outline-secondary" :disabled="deletingProject" @click="projectPendingDeletion = null">
            Cancel
          </button>
          <button type="button" class="btn btn-danger" :disabled="deletingProject" @click="confirmDeleteProject">
            <Trash2 :size="17" aria-hidden="true" />
            {{ deletingProject ? "Deleting" : "Delete project" }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
