// src/do/PortalKernel.ts
// Portal‑OS Phase‑12 — Single Durable Object Kernel
// All lanes (portal, planetary, sim, windows, identity, umbrella, timeline, diff, replay)
// Strict mode with JWT verification and Umbrella governance

import { Hono } from "hono";

export interface Env {
  PORTAL_OS_PHASE: string;
  PLANETARY_MODE: string;
  UMBRELLA_ENFORCEMENT: string;
  IDENTITY_JWT_ISSUER: string;
  IDENTITY_JWT_AUDIENCE: string;
  IDENTITY_JWT_SECRET: string;
}

export interface Phase12Envelope {
  id: string;
  lane: string; // portal | planetary | sim | windows | identity | umbrella | timeline | diff | replay
  op: string;
  identity?: string; // JWT token
  meta?: Record<string, any>;
  payload?: Record<string, any>;
}

export interface IdentityContext {
  sub: string;
  roles: string[];
  iat: number;
  exp: number;
}

export interface LaneResult<T = any> {
  ok: boolean;
  id: string;
  lane: string;
  op: string;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

// ============================================================
// Durable Object: PortalKernel
// ============================================================

export class PortalKernel {
  private state: DurableObjectState;
  private env: Env;
  private router: Hono;
  private storage: Map<string, any>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.storage = new Map();
    this.router = this.buildRouter();
  }

  async fetch(request: Request): Promise<Response> {
    return this.router.fetch(request);
  }

  private buildRouter(): Hono {
    const app = new Hono();

    // Parse envelope from request
    app.use("*", async (c, next) => {
      try {
        const envelope = await this.parseEnvelope(c.req);
        c.set("envelope", envelope);
        await next();
      } catch (error) {
        return c.json(
          {
            ok: false,
            id: "unknown",
            lane: "unknown",
            op: "unknown",
            status: 400,
            error: {
              code: "INVALID_ENVELOPE",
              message: error instanceof Error ? error.message : "Invalid envelope",
            },
          },
          400
        );
      }
    });

    // Portal lane
    app.post("/portal", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handlePortalLane(envelope, identity);
      return c.json(result);
    });

    // Planetary lane
    app.post("/planetary", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handlePlanetaryLane(envelope, identity);
      return c.json(result);
    });

    // SIM lane
    app.post("/sim", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handleSimLane(envelope, identity);
      return c.json(result);
    });

    // Windows lane
    app.post("/windows", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handleWindowsLane(envelope, identity);
      return c.json(result);
    });

    // Identity lane (no auth required)
    app.post("/identity", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const result = await this.handleIdentityLane(envelope);
      return c.json(result);
    });

    // Umbrella lane
    app.post("/umbrella", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handleUmbrellaLane(envelope, identity);
      return c.json(result);
    });

    // Timeline lane
    app.post("/planetary/timeline", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handleTimelineLane(envelope, identity);
      return c.json(result);
    });

    // Diff lane
    app.post("/planetary/diff", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handleDiffLane(envelope, identity);
      return c.json(result);
    });

    // Replay lane
    app.post("/planetary/replay", async (c) => {
      const envelope = c.get("envelope") as Phase12Envelope;
      const identity = await this.enforceIdentity(envelope);
      await this.enforceUmbrella(envelope, identity);
      const result = await this.handleReplayLane(envelope, identity);
      return c.json(result);
    });

    return app;
  }

  // ============================================================
  // Envelope Protocol
  // ============================================================

  private async parseEnvelope(req: any): Promise<Phase12Envelope> {
    const body = await req.json();

    if (!body.id || typeof body.id !== "string") {
      throw new Error("Envelope.id is required");
    }
    if (!body.lane || typeof body.lane !== "string") {
      throw new Error("Envelope.lane is required");
    }
    if (!body.op || typeof body.op !== "string") {
      throw new Error("Envelope.op is required");
    }

    return {
      id: body.id,
      lane: body.lane,
      op: body.op,
      identity: body.identity,
      meta: body.meta || {},
      payload: body.payload || {},
    };
  }

  // ============================================================
  // Identity Enforcement (JWT)
  // ============================================================

  private async enforceIdentity(envelope: Phase12Envelope): Promise<IdentityContext | null> {
    // Identity lane is exempt
    if (envelope.lane === "identity") return null;

    const token = envelope.identity;
    if (!token) {
      throw new Error("StrictMode: identity JWT required for non-identity lane");
    }

    // TODO: Replace with real JWT verification using jose or jwt-decode
    // For now, stub verification
    return this.verifyJWT(token);
  }

  private verifyJWT(token: string): IdentityContext {
    // Placeholder: Real implementation should use jwt library
    // and verify against IDENTITY_JWT_SECRET
    return {
      sub: "stub-user",
      roles: ["user"],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  // ============================================================
  // Umbrella Governance
  // ============================================================

  private async enforceUmbrella(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<void> {
    const enforcement = this.env.UMBRELLA_ENFORCEMENT || "strict";
    if (enforcement === "off") return;

    // Strict mode rules
    if (enforcement === "strict") {
      // Planetary mutations require identity
      if (envelope.lane === "planetary" && ["tick", "sync", "fork"].includes(envelope.op) && !identity) {
        throw new Error("UmbrellaStrict: planetary mutation requires identity");
      }

      // High-impact ops require governance meta
      const highImpactOps = ["reset", "collapse", "fork"];
      if (highImpactOps.includes(envelope.op) && !envelope.meta?.governance) {
        throw new Error("UmbrellaStrict: high-impact op requires governance meta");
      }
    }
  }

  // ============================================================
  // Lane Handlers
  // ============================================================

  private async handlePortalLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // Portal lane: surface, panels, console state
    const { op, payload } = envelope;

    switch (op) {
      case "read":
        return this.ok(envelope, { surface: "portal-state" });
      case "write":
        this.storage.set("portal_state", payload);
        return this.ok(envelope, { written: true });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handlePlanetaryLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // Planetary lane: substrate, nodes, quantum, collapse
    const { op, payload } = envelope;

    switch (op) {
      case "tick":
        return this.ok(envelope, { tick: 1, delta: null });
      case "sync":
        this.storage.set("planetary_state", payload);
        return this.ok(envelope, { synced: true });
      case "fork":
        return this.ok(envelope, { fork_id: this.randomId() });
      case "collapse":
        return this.ok(envelope, { collapsed: true });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handleSimLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // SIM lane: simulation trajectories
    const { op, payload } = envelope;

    switch (op) {
      case "step":
        return this.ok(envelope, { trajectory: "stepped" });
      case "branch":
        return this.ok(envelope, { branch_id: this.randomId() });
      case "integrate":
        return this.ok(envelope, { integrated: true });
      case "observe":
        return this.ok(envelope, { observation: payload });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handleWindowsLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // Windows lane: OS windows, registry
    const { op, payload } = envelope;

    switch (op) {
      case "create":
        return this.ok(envelope, { window_id: this.randomId() });
      case "close":
        return this.ok(envelope, { closed: true });
      case "focus":
        return this.ok(envelope, { focused: true });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handleIdentityLane(envelope: Phase12Envelope): Promise<LaneResult> {
    // Identity lane: login, tokens, introspection (no auth)
    const { op, payload } = envelope;

    switch (op) {
      case "login":
        return this.ok(envelope, { token: "stub-jwt-token", expires_in: 3600 });
      case "verify":
        return this.ok(envelope, { valid: true });
      case "introspect":
        return this.ok(envelope, { sub: "stub-user", roles: ["user"] });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handleUmbrellaLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // Umbrella lane: governance, enforcement inspection
    const { op, payload } = envelope;

    switch (op) {
      case "check":
        return this.ok(envelope, { allowed: true, policy: "default" });
      case "audit":
        return this.ok(envelope, { audit_log: [] });
      case "enforce":
        return this.ok(envelope, { enforced: true });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handleTimelineLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // Timeline lane: event history
    const { op, payload } = envelope;

    switch (op) {
      case "read":
        return this.ok(envelope, { events: [] });
      case "append":
        return this.ok(envelope, { appended: true });
      case "query":
        return this.ok(envelope, { results: [] });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handleDiffLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // Diff lane: state comparison
    const { op, payload } = envelope;

    switch (op) {
      case "diff":
        return this.ok(envelope, { diff: { added: [], removed: [], changed: [] } });
      case "reconcile":
        return this.ok(envelope, { reconciled: true });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  private async handleReplayLane(envelope: Phase12Envelope, identity: IdentityContext | null): Promise<LaneResult> {
    // Replay lane: replay events, states
    const { op, payload } = envelope;

    switch (op) {
      case "replay":
        return this.ok(envelope, { replayed: true });
      case "fork_at":
        return this.ok(envelope, { fork_id: this.randomId() });
      case "observe":
        return this.ok(envelope, { observation: null });
      default:
        return this.error(envelope, "UNKNOWN_OP", `Unknown op: ${op}`, 400);
    }
  }

  // ============================================================
  // Response Helpers
  // ============================================================

  private ok<T>(envelope: Phase12Envelope, data: T): LaneResult<T> {
    return {
      ok: true,
      id: envelope.id,
      lane: envelope.lane,
      op: envelope.op,
      status: 200,
      data,
    };
  }

  private error(envelope: Phase12Envelope, code: string, message: string, status: number): LaneResult {
    return {
      ok: false,
      id: envelope.id,
      lane: envelope.lane,
      op: envelope.op,
      status,
      error: { code, message },
    };
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
