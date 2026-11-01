-- A reservation is committed before calling the provider. An uncertain creation
-- remains reserved until reconciled; retries must never create a second charge.
CREATE TABLE company_subscriptions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    plan_id text NOT NULL,
    provider_id text UNIQUE,
    status text NOT NULL DEFAULT 'creating',
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_subscription_current ON company_subscriptions(tenant_id)
    WHERE status NOT IN ('cancelled', 'rejected');
CREATE INDEX company_subscription_history ON company_subscriptions(tenant_id, created_at DESC);
ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY company_subscriptions_isolation ON company_subscriptions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
