import { describe, it, expect } from "vitest";
import app from "#/web/api";

describe("web api", () => {
  it("GET /api/ping returns 200 { ok: true }", async () => {
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("GET /api/context returns { workspaceId: null } when no context is injected", async () => {
    const res = await app.request("/api/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ workspaceId: null });
  });
});
