export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE';

export interface HealthAttestationResponse {
  nodeId: string;
  status: HealthStatus;
  wiringStatus: { processManager: boolean; simulationEngine: boolean };
  authoritativeAttestation: {
    d1HeartbeatPersisted: boolean;
    durableObjectLeaseValid: boolean;
    qalSignatureVerified: boolean;
    latencyMs: number;
  };
  timestamp: number;
}

export interface HealthAttestationEnv {
  DB?: D1Database;
  PORTAL_KERNEL?: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
  };
  /** PEM encoded RSA SubjectPublicKeyInfo public key. */
  QAL_PUBLIC_KEY_PEM?: string;
  ENVIRONMENT?: string;
  /** Optional fast diagnostic callbacks; absent callbacks fail closed. */
  PROCESS_MANAGER_READY?: () => boolean;
  SIMULATION_ENGINE_READY?: () => boolean;
}

const NODE_ID = 'planetary-edge-node-01';
const FRESHNESS_WINDOW_MS = 60_000;

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodePublicKeyPem(pem: string): Uint8Array {
  const encoded = pem
    .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');
  return decodeBase64(encoded);
}

async function verifyRSASSA(
  canonicalClaim: string,
  signature: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      decodePublicKeyPem(publicKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decodeBase64(signature),
      new TextEncoder().encode(canonicalClaim),
    );
  } catch {
    return false;
  }
}

function wiringProbe(probe: (() => boolean) | undefined): boolean {
  try {
    return probe?.() === true;
  } catch {
    return false;
  }
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /health and /healthz: fast diagnostic tier unless `level=authoritative`.
 * Authoritative readiness requires a fresh, signed claim, successful D1 write,
 * and a durable, unexpired lease reported by the PortalKernel object.
 */
export async function handleAuthoritativeHealthCheck(
  request: Request,
  env: HealthAttestationEnv,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const started = performance.now();
  const now = Date.now();
  const wiringStatus = {
    processManager: wiringProbe(env.PROCESS_MANAGER_READY),
    simulationEngine: wiringProbe(env.SIMULATION_ENGINE_READY),
  };
  const url = new URL(request.url);

  if (url.searchParams.get('level') !== 'authoritative') {
    const healthy = wiringStatus.processManager && wiringStatus.simulationEngine;
    return json({
      status: healthy ? 'HEALTHY' : 'DEGRADED',
      tier: 'DIAGNOSTIC_WIRING',
      wiringStatus,
      timestamp: now,
    }, healthy ? 200 : 503);
  }

  let d1HeartbeatPersisted = false;
  let durableObjectLeaseValid = false;
  let qalSignatureVerified = false;
  let nodeReachable = true;
  const signature = request.headers.get('X-QAL-Attestation-Sig');
  const signedAtText = request.headers.get('X-QAL-Attestation-Timestamp');
  const signedAt = signedAtText === null ? Number.NaN : Number(signedAtText);
  const fresh = Number.isSafeInteger(signedAt) && Math.abs(now - signedAt) <= FRESHNESS_WINDOW_MS;

  if (signature && fresh && env.QAL_PUBLIC_KEY_PEM) {
    qalSignatureVerified = await verifyRSASSA(
      `nodeId=${NODE_ID}&timestamp=${signedAt}`,
      signature,
      env.QAL_PUBLIC_KEY_PEM,
    );
  }

  // Do not write a HEALTHY heartbeat until the signature has been verified.
  if (qalSignatureVerified && env.DB) {
    try {
      const result = await env.DB.prepare(`
        INSERT INTO node_heartbeats
          (node_id, worker_environment, status, active_isolates, qal_signature, last_tick_timestamp)
        VALUES (?, ?, 'HEALTHY', 1, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          worker_environment = excluded.worker_environment,
          status = excluded.status,
          active_isolates = excluded.active_isolates,
          qal_signature = excluded.qal_signature,
          last_tick_timestamp = excluded.last_tick_timestamp
      `).bind(NODE_ID, env.ENVIRONMENT ?? 'unknown', signature, signedAt).run();
      d1HeartbeatPersisted = result.success;
    } catch {
      d1HeartbeatPersisted = false;
      nodeReachable = false;
    }
  }

  if (env.PORTAL_KERNEL) {
    try {
      const stub = env.PORTAL_KERNEL.get(env.PORTAL_KERNEL.idFromName('global-health-anchor'));
      const lease = await stub.fetch(new Request('https://portal-kernel/health/lease'));
      if (lease.ok) {
        const body: unknown = await lease.json();
        if (typeof body === 'object' && body !== null && 'leaseExpiresAt' in body) {
          const expiry = Number((body as { leaseExpiresAt: unknown }).leaseExpiresAt);
          durableObjectLeaseValid = (body as { leaseValid?: unknown }).leaseValid === true
            && Number.isSafeInteger(expiry)
            && expiry > now;
        }
      } else {
        nodeReachable = false;
      }
    } catch {
      nodeReachable = false;
    }
  } else {
    nodeReachable = false;
  }

  const latencyMs = performance.now() - started;
  const gatesPass = d1HeartbeatPersisted && durableObjectLeaseValid && qalSignatureVerified;
  let status: HealthStatus = gatesPass ? 'HEALTHY' : nodeReachable ? 'DEGRADED' : 'UNREACHABLE';

  // Audit every authoritative probe. If this ledger write fails, readiness fails.
  if (env.DB) {
    try {
      const audit = await env.DB.prepare(`
        INSERT INTO attestation_logs (node_id, probe_type, latency_ms, verified, timestamp)
        VALUES (?, 'AUTHORITATIVE_LEASE', ?, ?, ?)
      `).bind(NODE_ID, latencyMs, gatesPass ? 1 : 0, now).run();
      if (!audit.success) status = 'DEGRADED';
    } catch {
      status = 'DEGRADED';
    }
  } else {
    status = 'UNREACHABLE';
  }

  const response: HealthAttestationResponse = {
    nodeId: NODE_ID,
    status,
    wiringStatus,
    authoritativeAttestation: {
      d1HeartbeatPersisted,
      durableObjectLeaseValid,
      qalSignatureVerified,
      latencyMs,
    },
    timestamp: now,
  };
  return json(response, status === 'HEALTHY' ? 200 : 503);
}
