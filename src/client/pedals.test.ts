import { beforeEach, describe, expect, it } from "vitest";
import { NEW_PROJECT_ID, type PedalBindings, type ProjectRecord } from "../shared/types";
import {
  actionForCode,
  defaultSelection,
  moveSelection,
  pedalBindingStorageKey,
  savePedalBindings,
  selectionItems
} from "./pedals";

const projects: ProjectRecord[] = [
  { id: "a", name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z", sortOrder: 0 },
  { id: "b", name: "Beta", createdAt: "2026-01-01T00:00:01.000Z", sortOrder: 1 }
];

describe("pedal selection", () => {
  it("adds the new-project option after existing projects", () => {
    expect(selectionItems(projects).map((item) => item.id)).toEqual(["a", "b", NEW_PROJECT_ID]);
  });

  it("wraps left and right through projects and new project", () => {
    const items = selectionItems(projects);

    expect(moveSelection("a", items, -1)).toBe(NEW_PROJECT_ID);
    expect(moveSelection(NEW_PROJECT_ID, items, 1)).toBe("a");
    expect(moveSelection("a", items, 1)).toBe("b");
  });

  it("falls back to the first project if stored selection is gone", () => {
    expect(defaultSelection(projects, "missing")).toBe("a");
    expect(defaultSelection(projects, "b")).toBe("b");
  });
});

describe("pedal bindings", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
  });

  it("maps keyboard codes to calibrated actions", () => {
    const bindings: PedalBindings = { left: "KeyA", center: "KeyS", right: "KeyD" };

    expect(actionForCode("KeyA", bindings)).toBe("left");
    expect(actionForCode("KeyS", bindings)).toBe("center");
    expect(actionForCode("KeyD", bindings)).toBe("right");
    expect(actionForCode("Space", bindings)).toBeNull();
  });

  it("stores bindings in local storage", () => {
    savePedalBindings({ left: "Digit1", center: "Digit2", right: "Digit3" });

    expect(window.localStorage.getItem(pedalBindingStorageKey)).toBe(
      JSON.stringify({ left: "Digit1", center: "Digit2", right: "Digit3" })
    );
  });
});
