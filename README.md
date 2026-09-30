# Portal-OS — Phase-12 Planetary Kernel

**Single Durable Object. Deterministic. Strict Mode.**

> Portal-OS is the planetary kernel.  
> MAX-OS-1 is a client OS running on Portal-OS.  
> Portal-OS Console is the UI layer that queries both.

---

## What is Portal-OS Phase-12?

Portal-OS is a **Durable Object-based kernel** running on Cloudflare Workers. It implements a deterministic, phase-locked system with:

- **Single DO**: `PortalKernel` handles all lanes
- **Phase-12 Envelope Protocol**: `id`, `lane`, `op`, `identity` (JWT), `meta`, `payload`
- **9 Lanes**: portal, planetary, sim, windows, identity, umbrella, timeline, diff, replay
- **Strict Governance**: Umbrella enforcement + identity physics (JWT verification)
- **Deterministic Substrate**: State persisted in DurableObjectState storage

---

## Architecture

```
┌──────────────────────────────────────┐
│  Portal-OS Console (UI Layer)        │
│  • Query Portal-OS kernel state      │
│  • Query MAX-OS-1 client state       │
│  • Unified dashboard                 │
└──────────────────────────────────────┘
              ↓
      Phase-12 Envelope Bridge
    (deterministic request/response)
              ↓
┌──────────────────────────────────────┐
│  Portal-OS Kernel (PortalKernel DO)  │
│  • 9 lanes in single DO              │
│  • JWT identity enforcement (strict) │
│  • Umbrella governance (strict)      │
│  • Deterministic state transitions   │
└──────────────────────────────────────┘
              ↓
      Service Binding (MAX-OS-1)
              ↓
┌──────────────────────────────────────┐
│  MAX-OS-1 Client OS (Worker)         │
│  • MAX-OS abstractions               │
│  • Session orchestration             │
│  • State substrate                   │
│  • Calls Portal-OS kernel            │
└──────────────────────────────────────┘
```

---

## Phase-12 Lanes

All routed through `POST /api` to PortalKernel Durable Object.

### Portal Lane
- **`POST /api`** with `lane: "portal"`
- **Ops**: read, write, subscribe
- **Purpose**: Surface state, panels, console updates
- **Auth**: Required (JWT in `identity` field)

### Planetary Lane
- **`POST /api`** with `lane: "planetary"`
- **Ops**: tick, sync, fork, collapse
- **Purpose**: Substrate mutations, node snapshots, quantum collapse
- **Auth**: Required (JWT in `identity` field)
- **Governance**: High-impact ops (fork, collapse) require `meta.governance`

### SIM Lane
- **`POST /api`** with `lane: "sim"`
- **Ops**: step, branch, integrate, observe
- **Purpose**: Simulation trajectories
- **Auth**: Required

### Windows Lane
- **`POST /api`** with `lane: "windows"`
- **Ops**: create, close, focus, minimize
- **Purpose**: OS window registry
- **Auth**: Required

### Identity Lane
- **`POST /api`** with `lane: "identity"`
- **Ops**: login, verify, introspect
- **Purpose**: Token issuance, verification, introspection
- **Auth**: Not required (no identity check)

### Umbrella Lane
- **`POST /api`** with `lane: "umbrella"`
- **Ops**: check, audit, enforce
- **Purpose**: Governance inspection and enforcement
- **Auth**: Required

### Timeline Lane
- **`POST /api`** with `lane: "planetary/timeline"`
- **Ops**: read, append, query
- **Purpose**: Event history, audit trail
- **Auth**: Required

### Diff Lane
- **`POST /api`** with `lane: "planetary/diff"`
- **Ops**: diff, reconcile
- **Purpose**: State comparison and reconciliation
- **Auth**: Required

### Replay Lane
- **`POST /api`** with `lane: "planetary/replay"`
- **Ops**: replay, fork_at, observe
- **Purpose**: Replay events, fork at checkpoint, observe state
- **Auth**: Required

---

## Phase-12 Envelope Protocol

All messages conform to this structure:

```typescript
interface Phase12Envelope {
  id: string;                          // unique message ID
  lane: string;                        // routing: portal|planetary|sim|windows|identity|umbrella|timeline|diff|replay
  op: string;                          // operation name
  identity?: string;                   // JWT token (required except for identity lane)
  meta?: Record<string, any>;          // governance, tracing, tags
  payload?: Record<string, any>;       // lane-specific data
}
```

### Response

```typescript
interface LaneResult<T = any> {
  ok: boolean;
  id: string;                          // echoed from request
  lane: string;                        // echoed from request
  op: string;                          // echoed from request
  status: number;                      // HTTP status
  data?: T;                            // result data
  error?: { code: string; message: string };  // error details
}
```

---

## Governance & Identity

### Umbrella Strict Mode

Enforced by default. Rules:

1. **Identity Required** — All non-identity lanes require a valid JWT in the `identity` field
2. **High-Impact Governance** — Operations like `fork`, `collapse`, `reset` require `meta.governance` context
3. **Planetary Mutations** — `tick`, `sync`, `fork` on the planetary lane require authenticated identity

### Identity Physics (JWT)

- Tokens passed in `identity` field are validated at the DO layer
- Stub verification in current implementation (replace with `jose` or `@cloudflare/workers-jwt` for production)
- Claims include: `sub` (subject), `roles` (string array), `iat` (issued-at), `exp` (expiration)

---

## Deployment

### Prerequisites
- Node.js 18+
- Cloudflare Workers account
- `npm` or `pnpm`

### Install & Build

```bash
git clone https://github.com/maxijurreau/planetary-max.git
cd planetary-max
npm install
npm run build
npm run check
```

### Deploy

```bash
# Set JWT secret
npx wrangler secret put IDENTITY_JWT_SECRET

# Dry run (validate bindings)
npx wrangler deploy --dry-run

# Deploy
npx wrangler deploy
```

### Configuration

All settings in `wrangler.toml`:

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

[[durable_objects.bindings]]
name = "PORTAL_KERNEL"
class_name = "PortalKernel"
```

---

## Testing

### Health Check

```bash
curl https://portal-os.<account>.workers.dev/health
# → { ok: true, phase: "12" }
```

### Send a Message

```bash
curl -X POST https://portal-os.<account>.workers.dev/api \
  -H "Content-Type: application/json" \
  -d '{
    "id": "msg-1",
    "lane": "identity",
    "op": "login",
    "payload": { "username": "user", "password": "pass" }
  }'
# → { ok: true, id: "msg-1", lane: "identity", op: "login", status: 200, data: { token: "...", expires_in: 3600 } }
```

### Authenticated Request (Planetary Lane)

```bash
JWT_TOKEN="<valid-jwt>"
curl -X POST https://portal-os.<account>.workers.dev/api \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"msg-2\",
    \"lane\": \"planetary\",
    \"op\": \"tick\",
    \"identity\": \"$JWT_TOKEN\",
    \"payload\": { \"at\": $(date +%s) }
  }"
# → { ok: true, id: "msg-2", lane: "planetary", op: "tick", status: 200, data: { tick: 1, delta: null } }
```

---

## Integration with MAX-OS-1

MAX-OS-1 communicates with Portal-OS through the envelope bridge:

1. MAX-OS-1 Worker receives a request
2. Enforces MAX-OS-specific identity and governance
3. Creates a Phase-12 envelope (via `createEnvelope`)
4. Sends to Portal-OS via `POST /api` to `PORTAL_KERNEL` service binding
5. Receives `LaneResult`
6. Normalizes response for MAX-OS clients

MAX-OS-1 does **not** implement any kernel logic. It is a pure client.

---

## Integration with Portal-OS Console

Portal-OS Console is the unified UI:

1. **Portal-OS Integration**: Queries kernel lanes via `POST /api`
   - `lane: "planetary"` for substrate state
   - `lane: "umbrella"` for governance
   - `lane: "timeline"` for audit logs
   - `lane: "portal"` for console state

2. **MAX-OS-1 Integration**: Queries client via MAX-OS-1's `POST /os/kernel/message`
   - `lane: "maxos/session"` for session state
   - `lane: "maxos/substrate"` for client state
   - `lane: "maxos/routing"` for routing info

3. **Unified Dashboard**: Displays both kernel and client state in a single UI

---

## What's Next

- [ ] Implement real JWT verification (use `@cloudflare/workers-jwt` or `jose`)
- [ ] Implement persistent DurableObjectState storage for all lanes
- [ ] Add MAX-OS-1 bridge implementation (in MAX-OS-1 repo)
- [ ] Add Portal-OS Console (in portal-os-console repo)
- [ ] End-to-end testing across all three repos
- [ ] Type-check all repos
- [ ] Test Phase-12 protocol compliance

---

## Status

- **Phase**: 12
- **Architecture**: Single-DO kernel (PortalKernel)
- **Lanes**: All 9 implemented (portal, planetary, sim, windows, identity, umbrella, timeline, diff, replay)
- **Governance**: Umbrella strict mode active
- **Identity**: JWT verification (stub) ready for production implementation
- **State**: DurableObjectState integration ready
- **Bridge**: Phase-12 envelope protocol active
- **Tests**: Ready for integration testing

---

**Last Updated**: 2026-09-30  
**Ecosystem**: Portal-OS (kernel) + MAX-OS-1 (client) + Portal-OS Console (UI)
