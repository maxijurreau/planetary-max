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
  return decodeBase64(
    pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/g, '').replace(/\s/g, ''),
  );
}

async function verifyRSASSA(claim: string, signature: string, publicKeyPem: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki', decodePublicKeyPem(publicKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, decodeBase64(signature), new TextEncoder().encode(claim),
    );
  } catch {
    return false;
  }
}

function wiringProbe(probe: (() => boolean) | undefined): boolean {
  try { return probe?.() === true; } catch { return false; }
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** GET /health and /healthz: diagnostic by default; authoritative only with level=authoritative. */
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
  if (new URL(request.url).searchParams.get('level') !== 'authoritative') {
    const diagnosticHealthy = wiringStatus.processManager && wiringStatus.simulationEngine;
    return json({
      status: diagnosticHealthy ? 'HEALTHY' : 'DEGRADED',
      tier: 'DIAGNOSTIC_WIRING', wiringStatus, timestamp: now,
    }, diagnosticHealthy ? 200 : 503);
  }

  const signature = request.headers.get('X-QAL-Attestation-Sig');
  const signedAtHeader = request.headers.get('X-QAL-Attestation-Timestamp');
  const signedAt = signedAtHeader === null ? Number.NaN : Number(signedAtHeader);
  const signatureFresh = Number.isSafeInteger(signedAt)
    && Math.abs(now - signedAt) <= FRESHNESS_WINDOW_MS;
  const qalSignatureVerified = Boolean(signature && signatureFresh && env.QAL_PUBLIC_KEY_PEM)
    && await verifyRSASSA(
      `nodeId=${NODE_ID}&timestamp=${signedAt}`,
      signature ?? '',
      env.QAL_PUBLIC_KEY_PEM ?? '',
    );

  let durableObjectLeaseValid = false;
  let nodeReachable = false;
  if (env.PORTAL_KERNEL) {
    try {
      const stub = env.PORTAL_KERNEL.get(env.PORTAL_KERNEL.idFromName('global-health-anchor'));
      const response = await stub.fetch(new Request('https://portal-kernel/health/lease'));
      if (response.ok) {
        nodeReachable = true;
        const body: unknown = await response.json();
        if (typeof body === 'object' && body !== null && 'leaseExpiresAt' in body) {
          const lease = body as { leaseExpiresAt: unknown; leaseValid?: unknown };
          durableObjectLeaseValid = lease.leaseValid === true
            && Number.isSafeInteger(Number(lease.leaseExpiresAt))
            && Number(lease.leaseExpiresAt) > now;
        }
      }
    } catch {
      nodeReachable = false;
    }
  }

  // Evaluate all independent evidence first, then persist exactly that result.
  const preliminaryStatus: HealthStatus = qalSignatureVerified && durableObjectLeaseValid
    ? 'HEALTHY'
    : nodeReachable ? 'DEGRADED' : 'UNREACHABLE';
  const latencyMs = performance.now() - started;
  let d1HeartbeatPersisted = false;
  let status = preliminaryStatus;

  if (env.DB) {
    try {
      const result = await env.DB.prepare(`
        INSERT INTO node_heartbeats
          (node_id, worker_environment, status, active_isolates, qal_signature, last_tick_timestamp)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          worker_environment=excluded.worker_environment,
          status=excluded.status,
          active_isolates=excluded.active_isolates,
          qal_signature=excluded.qal_signature,
          last_tick_timestamp=excluded.last_tick_timestamp
      `).bind(
        NODE_ID, env.ENVIRONMENT ?? 'unknown', preliminaryStatus,
        signature ?? 'MISSING', Number.isSafeInteger(signedAt) ? signedAt : now,
      ).run();
      d1HeartbeatPersisted = result.success;
      if (!d1HeartbeatPersisted) status = 'UNREACHABLE';
    } catch {
      status = 'UNREACHABLE';
    }

    try {
      const audit = await env.DB.prepare(`
        INSERT INTO attestation_logs (node_id, probe_type, latency_ms, verified, timestamp)
        VALUES (?, 'AUTHORITATIVE_LEASE', ?, ?, ?)
      `).bind(NODE_ID, latencyMs, status === 'HEALTHY' ? 1 : 0, now).run();
      if (!audit.success && status === 'HEALTHY') status = 'DEGRADED';
    } catch {
      if (status === 'HEALTHY') status = 'DEGRADED';
    }
  } else {
    status = 'UNREACHABLE';
  }

  const result: HealthAttestationResponse = {
    nodeId: NODE_ID, status, wiringStatus,
    authoritativeAttestation: {
      d1HeartbeatPersisted, durableObjectLeaseValid, qalSignatureVerified,
      latencyMs: performance.now() - started,
    },
    timestamp: now,
  };
  return json(result, status === 'HEALTHY' ? 200 : 503);
}
