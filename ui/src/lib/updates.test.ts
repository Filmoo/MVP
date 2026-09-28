import { describe, expect, it } from "vitest";
import { aboutLine, requiredStep } from "./updates";

describe("update wording", () => {
  it("offers one action per state, never while a check runs", () => {
    expect(aboutLine({ state: "upToDate" })).toMatchObject({ action: "check", label: "Check for updates" });
    expect(aboutLine({ state: "checking" })).toMatchObject({ action: "check", busy: true });
    expect(aboutLine({ state: "ready", version: "0.2.0", notes: null, mandatory: false })).toMatchObject({
      action: "restart",
      label: "Restart to update",
    });
    expect(aboutLine({ state: "failed", message: "offline" })).toMatchObject({ action: "check", label: "Try again" });
    expect(aboutLine({ state: "downloading", version: "0.2.0", percent: 45 }).text).toBe("Downloading version 0.2.0 (45 %)…");
    expect(aboutLine({ state: "downloading", version: "0.2.0", percent: null }).text).toBe("Downloading version 0.2.0…");
    expect(aboutLine({ state: "available", version: "0.2.0", notes: null, mandatory: true }).action).toBeUndefined();
    expect(aboutLine({ state: "unavailable", reason: "development build" }).text).toContain("development build");
  });

  it("never offers to restart during a game", () => {
    const ready = { state: "ready", version: "0.2.0", notes: null, mandatory: true } as const;
    expect(requiredStep(ready, false)).toMatchObject({ action: "restart" });
    expect(requiredStep(ready, true)).toEqual({ text: "Finish your game first: MVP updates right after." });
    expect(requiredStep({ state: "upToDate" }, false)).toMatchObject({ action: "check" });
    expect(requiredStep({ state: "checking" }, false).action).toBeUndefined();
  });
});
