import { NEW_PROJECT_ID, type PedalAction, type PedalBindings, type ProjectRecord } from "../shared/types";

export interface SelectionItem {
  id: string;
  label: string;
  isNewProject: boolean;
}

export const pedalBindingStorageKey = "idea-collector-pedal-bindings";
export const selectedProjectStorageKey = "idea-collector-selected-project";

export function loadPedalBindings(): PedalBindings | null {
  const raw = window.localStorage.getItem(pedalBindingStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PedalBindings>;
    return isCompleteBindings(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePedalBindings(bindings: PedalBindings): void {
  window.localStorage.setItem(pedalBindingStorageKey, JSON.stringify(bindings));
}

export function clearPedalBindings(): void {
  window.localStorage.removeItem(pedalBindingStorageKey);
}

export function actionForCode(code: string, bindings: PedalBindings | null): PedalAction | null {
  if (!bindings) {
    return null;
  }

  if (code === bindings.left) {
    return "left";
  }
  if (code === bindings.center) {
    return "center";
  }
  if (code === bindings.right) {
    return "right";
  }

  return null;
}

export function selectionItems(projects: ProjectRecord[]): SelectionItem[] {
  return [
    ...projects.map((project) => ({
      id: project.id,
      label: project.name,
      isNewProject: false
    })),
    {
      id: NEW_PROJECT_ID,
      label: "+ New Project",
      isNewProject: true
    }
  ];
}

export function moveSelection(currentId: string | null, items: SelectionItem[], delta: -1 | 1): string {
  if (items.length === 0) {
    return NEW_PROJECT_ID;
  }

  const currentIndex = Math.max(
    0,
    items.findIndex((item) => item.id === currentId)
  );
  const nextIndex = (currentIndex + delta + items.length) % items.length;
  return items[nextIndex].id;
}

export function defaultSelection(projects: ProjectRecord[], storedProjectId: string | null): string {
  const items = selectionItems(projects);
  if (storedProjectId && items.some((item) => item.id === storedProjectId)) {
    return storedProjectId;
  }

  return items[0]?.id ?? NEW_PROJECT_ID;
}

function isCompleteBindings(value: Partial<PedalBindings>): value is PedalBindings {
  return Boolean(value.left && value.center && value.right);
}
