import { describe, expect, it } from "vitest";
import { cycleMode } from "../../../src/permission/helpers.js";

describe("agent mode cycling", () => {
  it("cycles through assistant, yolo, and restricted", () => {
    expect(cycleMode("assistant")).toBe("yolo");
    expect(cycleMode("yolo")).toBe("restricted");
    expect(cycleMode("restricted")).toBe("assistant");
  });
});
