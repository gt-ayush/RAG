import type {
  AuthorizationDecision,
  AuthorizationPrincipal,
  AuthorizationPolicy,
  RetrievalQuery,
  TenantAuthorizationPolicyConfig,
} from './types.js';

/**
 * Source-of-truth keywords: Authorization, tenant isolation, fail-closed,
 * policy evaluation, cross-tenant
 */

/**
 * Deterministic tenant authorization policy.
 *
 * Evaluates whether a trusted principal may access a retrieval request.
 * Fail-closed: any mismatch, missing principal, or error results in
 * `allowed: false`. Never logs principal identifiers or document contents.
 *
 * Rules:
 * - principal.tenantId must match config.tenantId (tenant isolation)
 * - If config.allowedDocumentIds is set, every document referenced by the
 *   request (via document filters) must be in the allow-list
 * - Client-supplied tenantId in the request is not trusted; only the
 *   principal's tenantId is authoritative
 */
export class TenantAuthorizationPolicy {
  readonly config: TenantAuthorizationPolicyConfig;

  constructor(config: TenantAuthorizationPolicyConfig) {
    this.config = {
      tenantId: config.tenantId,
      ...(config.allowedDocumentIds
        ? { allowedDocumentIds: [...config.allowedDocumentIds] }
        : {}),
    };
  }

  async decide(
    principal: AuthorizationPrincipal,
    request: RetrievalQuery,
  ): Promise<AuthorizationDecision> {
    // Fail closed: no principal or no tenantId on principal.
    if (!principal || !principal.tenantId) {
      return {
        allowed: false,
        reason: 'missing trusted tenant identity',
      };
    }

    // Tenant isolation: principal's tenant must match the configured tenant.
    if (principal.tenantId !== this.config.tenantId) {
      return {
        allowed: false,
        reason: 'tenant access denied',
        tenantId: principal.tenantId,
        ...(principal.allowedDocumentIds
          ? { allowedDocumentIds: principal.allowedDocumentIds }
          : {}),
      };
    }

    // Document allow-list: if configured, every document the request
    // touches must be in the allow-list.
    const requestDocIds = new Set<string>();
    if (request.filters?.['allowed_document_ids']) {
      const ids = request.filters['allowed_document_ids'];
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (typeof id === 'string') {
            requestDocIds.add(id);
          }
        }
      }
    }

    if (this.config.allowedDocumentIds && requestDocIds.size > 0) {
      const allowed = new Set(this.config.allowedDocumentIds);
      for (const docId of requestDocIds) {
        if (!allowed.has(docId)) {
          return {
            allowed: false,
            reason: `document access denied: ${docId}`,
            tenantId: principal.tenantId,
            allowedDocumentIds: this.config.allowedDocumentIds,
          };
        }
      }
    }

    return {
      allowed: true,
      reason: 'authorized',
      tenantId: principal.tenantId,
      ...(this.config.allowedDocumentIds
        ? { allowedDocumentIds: this.config.allowedDocumentIds }
        : {}),
    };
  }
}

/**
 * Creates a callable AuthorizationPolicy from a tenant config.
 * The returned function implements the AuthorizationPolicy type directly.
 */
export function makeAuthorizationPolicy(
  config: TenantAuthorizationPolicyConfig,
): AuthorizationPolicy {
  const policy = new TenantAuthorizationPolicy(config);
  return async (principal, request) => policy.decide(principal, request);
}

/**
 * Converts an AuthorizationPolicy decision into components suitable for
 * building a RetrievalAuthorization context passed to retrieve().
 * Fail-closed: denied decisions produce allowed=false.
 */
export function decisionToAuthzComponents(
  decision: AuthorizationDecision,
): {
  context: { tenantId?: string; allowedDocumentIds?: readonly string[] };
  allowed: boolean;
} {
  return {
    context: {
      ...(decision.tenantId ? { tenantId: decision.tenantId } : {}),
      ...(decision.allowedDocumentIds
        ? { allowedDocumentIds: decision.allowedDocumentIds }
        : {}),
    },
    allowed: decision.allowed,
  };
}
