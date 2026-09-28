import { describe, expect, it, vi } from "vitest";
import { fail, failFromError, ok } from "./http";
import { PanelError } from "./service";

describe("API envelope", () => {
  it("wraps data and errors consistently", async () => {
    expect(await ok({ a: 1 }).json()).toEqual({ success: true, data: { a: 1 }, error: null });
    const res = fail("nope", 400);
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ success: false, data: null, error: "nope" });
  });

  it("shows PanelError messages verbatim", async () => {
    const res = failFromError(new PanelError("already exists", 409), "Adding client");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already exists");
  });

  it("hides internal error details from the client", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = failFromError(new Error("sudo: /etc/secret path"), "Adding client");
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toContain("secret");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
