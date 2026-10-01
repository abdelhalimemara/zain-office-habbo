import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../src/state/store";
import { resetStore } from "./helpers";

describe("ui store", () => {
  beforeEach(resetStore);

  it("starts in the city with nothing open", () => {
    const s = useUiStore.getState();
    expect(s.view).toEqual({ kind: "city" });
    expect(s.panel).toBeNull();
    expect(s.selectedAgent).toBeNull();
  });

  it("enters a division floor and returns to the city, clearing panels", () => {
    useUiStore.getState().openPanel({ kind: "approvals" });
    useUiStore.getState().enterDivision("growth");
    expect(useUiStore.getState().view).toEqual({ kind: "floor", division: "growth" });
    expect(useUiStore.getState().panel).toBeNull();
    useUiStore.getState().openPanel({ kind: "kanban", division: "growth" });
    useUiStore.getState().goToCity();
    expect(useUiStore.getState().view).toEqual({ kind: "city" });
    expect(useUiStore.getState().panel).toBeNull();
  });

  it("selecting an agent opens its card; closing clears the selection", () => {
    useUiStore.getState().selectAgent("zain-tech-vp");
    expect(useUiStore.getState().selectedAgent).toBe("zain-tech-vp");
    expect(useUiStore.getState().panel).toEqual({ kind: "agent", profile: "zain-tech-vp" });
    useUiStore.getState().closePanel();
    expect(useUiStore.getState().selectedAgent).toBeNull();
    expect(useUiStore.getState().panel).toBeNull();
  });

  it("opening a task keeps the selected agent", () => {
    useUiStore.getState().selectAgent("zain-tech-vp");
    useUiStore.getState().openPanel({ kind: "task", id: "t1" });
    expect(useUiStore.getState().selectedAgent).toBe("zain-tech-vp");
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "t1" });
  });

  it("selectAgent(null) deselects and closes", () => {
    useUiStore.getState().selectAgent("default");
    useUiStore.getState().selectAgent(null);
    expect(useUiStore.getState().selectedAgent).toBeNull();
    expect(useUiStore.getState().panel).toBeNull();
  });
});
