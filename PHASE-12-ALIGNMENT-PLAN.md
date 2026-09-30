# Portal-OS / MAX-OS-1 / Console Alignment Plan

**Phase-12 Architecture Cleanup & Bridge Implementation**

---

## Architecture

```
┌─────────────────────────────────────┐
│  Portal-OS Console                  │
│  (UI Layer — unified surface)       │
│                                     │
│  • Subscribe to Portal-OS state     │
│  • Subscribe to MAX-OS-1 state      │
│  • Unified dashboard / panels       │
│  • Single entry point for clients   │
└─────────────────────────────────────┘
         ↓           ↓
    Portal-OS    MAX-OS-1
  (Kernel)      (Client OS)
```

---

## Repository Cleanup

### 1. Portal-OS (`planetary-max`) — Kernel Only

**Objective**: Single Durable Object. No legacy. Phase-12 clean.

#### Remove
- `src/do/PortalCanon.ts`
- `src/do/PortalReplay.ts`
- `src/do/PortalTimeline.ts`
- `src/do/PortalTimelineDiff.ts`
- `src/do/PortalScheduler.ts`
- `src/do/PortalSurface.ts`
- `src/do/PortalIdentitySurface.ts`
- `src/do/PortalQuantum.ts`
- `src/do/PortalAdvisory.ts`
- `src/do/PortalUmbrella.ts`
- `src/do/new_sqlite_classes.ts`

#### Keep
- `src/do/PortalKernel.ts` — Single Durable Object
- `src/do/index.ts` — Export only PortalKernel

#### Update `wrangler.toml`
```toml
name = "portal-os"
main = "src/index.ts"
compatibility_date = "2026-09-17"

[vars]
PORTAL_OS_PHASE = "12"
PLANETARY_MODE = "active"
UMBRELLA_ENFORCEMENT = "strict"
IDENTITY_JWT_ISSUER = "portal-os"
IDENTITY_JWT_AUDIENCE = "portal-os"
KERNEL_TIMEOUT_MS = "5000"
SUBSTRATE_TIMEOUT_MS = "3000"
MAX_RETRY_ATTEMPTS = "3"
RETRY_BASE_DELAY_MS = "50"
CIRCUIT_FAILURE_THRESHOLD = "5"
CIRCUIT_COOLDOWN_MS = "30000"

[env.production]
vars = { UMBRELLA_ENFORCEMENT = "strict" }

[[durable_objects.bindings]]
name = "PORTAL_KERNEL"
class_name = "PortalKernel"

[build]
command = "npm run build"
```

#### Phase-12 Lanes (PortalKernel)

**POST /portal** — Surface, panels, console state
- `op`: read, write, subscribe
- Payload: panel state, UI updates

**POST /planetary** — Substrate, nodes, quantum entropy
- `op`: tick, sync, fork, collapse
- Payload: node snapshot, governance, collapse policy

**POST /sim** — Simulation trajectories
- `op`: step, branch, integrate, observe
- Payload: trajectory delta, hypothesis, confidence

**POST /windows** — OS windows, registry
- `op`: create, close, focus, minimize
- Payload: window config

**POST /identity** — Login, tokens, introspection (no auth required)
- `op`: login, issue_token, verify, introspect
- Payload: credentials, token, introspection query

**POST /umbrella** — Governance, enforcement inspection
- `op`: check, audit, enforce
- Payload: policy query, enforcement context

**POST /planetary/timeline** — Event history
- `op`: read, append, query
- Payload: timestamp, range, filter

**POST /planetary/diff** — State comparison
- `op`: diff, reconcile
- Payload: state A, state B

**POST /planetary/replay** — Replay events, states
- `op`: replay, fork_at, observe
- Payload: event range, fork point

---

### 2. MAX-OS-1 (`MAX-OS-1`) — Client OS

**Objective**: Full bridge to Portal-OS. Phase-12 envelope protocol. No kernel code.

#### Add `src/bridge/`

**`src/bridge/envelope.ts`** — Envelope factory

```typescript
export interface Phase12Envelope {
  id: string;
  lane: string;  // "portal" | "planetary" | "sim" | "windows" | "identity" | "umbrella" | "timeline" | "diff" | "replay"
  op: string;
  identity?: string;  // JWT token
  meta?: Record<string, any>;  // governance, tracing, tags
  payload?: Record<string, any>;
}

export function createEnvelope(
  lane: string,
  op: string,
  payload: Record<string, any>,
  identity?: string,
  meta?: Record<string, any>
): Phase12Envelope {
  return {
    id: crypto.randomUUID(),
    lane,
    op,
    payload,
    ...(identity && { identity }),
    ...(meta && { meta }),
  };
}
```

**`src/bridge/client.ts`** — Portal-OS client

```typescript
export class PortalOSClient {
  constructor(private kernel: Fetcher) {}

  async send(envelope: Phase12Envelope): Promise<Response> {
    const res = await this.kernel.fetch(
      new Request("https://portal-os/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      })
    );
    return res;
  }

  async query(
    lane: string,
    op: string,
    payload: Record<string, any>,
    identity?: string
  ): Promise<any> {
    const envelope = createEnvelope(lane, op, payload, identity);
    const res = await this.send(envelope);
    const data = await res.json();
    if (!res.ok) throw new Error(`Portal-OS error: ${data.error?.message}`);
    return data.data;
  }
}
```

#### Update Routes

**`POST /os/kernel/message`** — Bridge to Portal-OS

```typescript
api.post("/os/kernel/message", async (c) => {
  const body = await c.req.json();
  const envelope = createEnvelope(
    body.lane,
    body.op,
    body.payload,
    c.get("identity_token"),
    body.meta
  );
  const client = new PortalOSClient(c.env.PORTAL_KERNEL);
  const result = await client.send(envelope);
  return c.json(await result.json());
});
```

#### MAX-OS-1 Lanes (via POST /os/kernel/message)

**Lane: `maxos/session`**
- `op`: create, destroy, list, state
- Session lifecycle management

**Lane: `maxos/routing`**
- `op`: resolve, trace, validate
- MAX-OS routing table queries

**Lane: `maxos/substrate`**
- `op`: read, write, transition, query
- MAX-OS state persistence

**Lane: `maxos/identity`**
- `op`: login, logout, verify_role
- MAX-OS identity management

**Lane: `maxos/governance`**
- `op`: check_policy, audit_access
- MAX-OS governance checks

#### Update `wrangler.toml`

```toml
name = "max-os-1"
main = "src/index.ts"
compatibility_date = "2026-09-17"

[vars]
MAX_OS_VERSION = "1"
PORTAL_OS_PHASE = "12"
KERNEL_TIMEOUT_MS = "5000"
SUBSTRATE_TIMEOUT_MS = "3000"
MAX_RETRY_ATTEMPTS = "3"
RETRY_BASE_DELAY_MS = "50"
CIRCUIT_FAILURE_THRESHOLD = "5"
CIRCUIT_COOLDOWN_MS = "30000"

[[services]]
binding = "PORTAL_KERNEL"
service = "portal-os"
environment = "production"

[[r2_buckets]]
binding = "MAXOS_STATE"
bucket_name = "max-os-1-state"

[build]
command = "npm run build"
```

---

### 3. Portal-OS Console (`portal-os-console`) — UI Layer

**Objective**: Unified dashboard. Query both Portal-OS and MAX-OS-1. Single surface.

#### Add `src/api/`

**`src/api/portal.ts`** — Portal-OS queries

```typescript
export class PortalAPI {
  constructor(private baseURL: string, private token: string) {}

  async getState(lane: string): Promise<any> {
    const res = await fetch(`${this.baseURL}/os/kernel/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        lane,
        op: "read",
        payload: {},
      }),
    });
    return res.json();
  }

  async query(lane: string, op: string, payload: any): Promise<any> {
    const res = await fetch(`${this.baseURL}/os/kernel/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.token}`,
      },
      body: JSON.stringify({ lane, op, payload }),
    });
    return res.json();
  }
}
```

**`src/api/maxos.ts`** — MAX-OS-1 queries

```typescript
export class MaxOSAPI {
  constructor(private baseURL: string, private token: string) {}

  async getState(lane: string): Promise<any> {
    const res = await fetch(`${this.baseURL}/os/kernel/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        lane: `maxos/${lane}`,
        op: "state",
        payload: {},
      }),
    });
    return res.json();
  }
}
```

#### Add `src/hooks/`

**`src/hooks/usePortalState.ts`** — Subscribe to Portal-OS

```typescript
export function usePortalState(lane: string) {
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const api = new PortalAPI(getPortalURL(), getToken());
    api.getState(lane)
      .then(setState)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [lane]);

  return { state, loading, error };
}
```

**`src/hooks/useMaxOSState.ts`** — Subscribe to MAX-OS-1

```typescript
export function useMaxOSState(lane: string) {
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const api = new MaxOSAPI(getMaxOSURL(), getToken());
    api.getState(lane)
      .then(setState)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [lane]);

  return { state, loading, error };
}
```

#### Add Components

**`src/components/KernelDashboard.tsx`** — Unified kernel + MAX-OS view

```typescript
export function KernelDashboard() {
  const portal = usePortalState("planetary");
  const maxos = useMaxOSState("session");

  return (
    <div className="dashboard">
      <section>
        <h2>Portal-OS Kernel</h2>
        {portal.loading ? <Spinner /> : <StateView state={portal.state} />}
      </section>
      <section>
        <h2>MAX-OS-1 Client</h2>
        {maxos.loading ? <Spinner /> : <StateView state={maxos.state} />}
      </section>
    </div>
  );
}
```

#### Update `vite.config.ts`

```typescript
export default defineConfig({
  server: {
    proxy: {
      "/api/portal": {
        target: process.env.VITE_PORTAL_URL || "https://portal-os.workers.dev",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/portal/, "/os/kernel/message"),
      },
      "/api/maxos": {
        target: process.env.VITE_MAXOS_URL || "https://max-os-1.workers.dev",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/maxos/, "/os/kernel/message"),
      },
    },
  },
});
```

---

## Deployment Order

1. **Portal-OS** (`planetary-max`)
   - Clean up legacy DOs
   - Update PortalKernel to Phase-12
   - Deploy: `npx wrangler deploy`
   - Service binding name: `portal-os`

2. **MAX-OS-1**
   - Implement bridge (`src/bridge/`)
   - Update routes (POST /os/kernel/message)
   - Configure `PORTAL_KERNEL` service binding to `portal-os`
   - Deploy: `npx wrangler deploy`
   - Service binding name: `max-os-1`

3. **Portal-OS Console**
   - Add Portal/MaxOS API clients
   - Add hooks for state subscription
   - Add unified dashboard component
   - Configure `.env.local`:
     - `VITE_PORTAL_URL=https://portal-os-<account>.workers.dev`
     - `VITE_MAXOS_URL=https://max-os-1-<account>.workers.dev`
   - Deploy: `npm run build && npm run deploy`

---

## Truth Statement

> Portal-OS is the planetary kernel.  
> MAX-OS-1 is a client OS running on Portal-OS.  
> Portal-OS Console is the UI layer that queries both.  
> They are three separate repos with a defined envelope bridge.

---

**Last Updated**: 2026-09-30  
**Phase**: 12  
**Status**: Cleanup and bridge implementation plan
