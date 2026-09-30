// src/index.ts
// Portal-OS Phase-12 — Worker Router

import { Hono } from "hono";
import { kernelStub } from "./kernel/stub";

const api = new Hono();

// ============================================================
// Health check
// ============================================================
api.get("/health", (c) => {
  return c.json({ ok: true, phase: "12" });
});

// ============================================================
// Portal-OS Kernel Message Bridge
// Routes all requests to the single PortalKernel DO
// ============================================================
api.post("/api", async (c) => {
  const body = await c.req.json();
  const stub = kernelStub(c.env);
  
  // Route based on lane
  const lane = body.lane || "unknown";
  const res = await stub.fetch(
    new Request(`https://portal-kernel/${lane}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

  return c.json(await res.json());
});

export default api;
export { PortalKernel } from "./do/PortalKernel";
