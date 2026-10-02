import { spriteFor } from "../../src/world/characters";
import { toWorldAgents, rosterOrFallback } from "../../src/app/worldModel";

describe("named agents", () => {
  it("gives Ahmad Al Zain his fixed male character", () => {
    expect(spriteFor("zain-hq-accounts", "lead")).toBe("people/male-2");
  });

  it("labels named agents by name in the world", () => {
    const ahmad = toWorldAgents(rosterOrFallback(undefined), undefined).find((a) => a.profile === "zain-hq-accounts");
    expect(ahmad?.title).toBe("Ahmad Al Zain");
  });
});
