import { describe, expect, it } from 'vitest';
import {
  TenantAuthorizationPolicy,
  makeAuthorizationPolicy,
  decisionToAuthzComponents,
} from '../src/authorization.js';
import type {
  AuthorizationDecision,
  AuthorizationPrincipal,
  RetrievalQuery,
  TenantAuthorizationPolicyConfig,
} from '../src/types.js';

function makePrincipal(tenantId: string, allowedDocumentIds?: readonly string[]): AuthorizationPrincipal {
  return { tenantId, ...(allowedDocumentIds ? { allowedDocumentIds } : {}) };
}

function makeQuery(text: string, filters?: Record<string, unknown>): RetrievalQuery {
  return { text, topK: 5, ...(filters ? { filters } : {}) };
}

describe('TenantAuthorizationPolicy', () => {
  const config: TenantAuthorizationPolicyConfig = {
    tenantId: 'tenant-a',
    allowedDocumentIds: ['doc-1', 'doc-2'],
  };

  it('allows principal in correct tenant with allowed document', async () => {
    const policy = new TenantAuthorizationPolicy(config);
    const principal = makePrincipal('tenant-a', ['doc-1']);
    const request = makeQuery('test query', { allowed_document_ids: ['doc-1'] });

    const decision = await policy.decide(principal, request);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('authorized');
    expect(decision.tenantId).toBe('tenant-a');
  });

  it('denies principal from different tenant (cross-tenant access)', async () => {
    const policy = new TenantAuthorizationPolicy(config);
    const principal = makePrincipal('tenant-b');
    const request = makeQuery('test query');

    const decision = await policy.decide(principal, request);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('tenant access denied');
    expect(decision.tenantId).toBe('tenant-b');
  });

  it('denies principal with missing tenantId', async () => {
    const policy = new TenantAuthorizationPolicy(config);
    const principal = { } as AuthorizationPrincipal;
    const request = makeQuery('test query');

    const decision = await policy.decide(principal, request);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('missing trusted tenant identity');
  });

  it('denies access to document not in allow-list', async () => {
    const policy = new TenantAuthorizationPolicy(config);
    const principal = makePrincipal('tenant-a');
    const request = makeQuery('test query', { allowed_document_ids: ['doc-999'] });

    const decision = await policy.decide(principal, request);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('document access denied: doc-999');
  });

  it('allows access when no document allow-list configured', async () => {
    const policy = new TenantAuthorizationPolicy({ tenantId: 'tenant-a' });
    const principal = makePrincipal('tenant-a');
    const request = makeQuery('test query', { allowed_document_ids: ['any-doc'] });

    const decision = await policy.decide(principal, request);

    expect(decision.allowed).toBe(true);
  });

  it('makes a callable AuthorizationPolicy via factory', async () => {
    const policy = makeAuthorizationPolicy(config);
    const principal = makePrincipal('tenant-a');
    const request = makeQuery('test query');

    const decision = await policy(principal, request);

    expect(decision.allowed).toBe(true);
    expect(decision.tenantId).toBe('tenant-a');
  });

  it('converts decision to authz components', () => {
    const decision: AuthorizationDecision = {
      allowed: true,
      reason: 'authorized',
      tenantId: 'tenant-a',
      allowedDocumentIds: ['doc-1'],
    };

    const components = decisionToAuthzComponents(decision);

    expect(components.allowed).toBe(true);
    expect(components.context).toEqual({ tenantId: 'tenant-a', allowedDocumentIds: ['doc-1'] });
  });

  it('converts denied decision to authz components with allowed=false', () => {
    const decision: AuthorizationDecision = {
      allowed: false,
      reason: 'tenant access denied',
      tenantId: 'tenant-b',
    };

    const components = decisionToAuthzComponents(decision);

    expect(components.allowed).toBe(false);
    expect(components.context).toEqual({ tenantId: 'tenant-b' });
  });
});
