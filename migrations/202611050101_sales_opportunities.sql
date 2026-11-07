CREATE TABLE sales_opportunities (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 customer_id uuid,
 order_id uuid,
 proposal_id uuid,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL REFERENCES identities(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES parties(tenant_id,id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES sales_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,proposal_id) REFERENCES sales_proposals(tenant_id,id)
);
CREATE INDEX opportunities_tenant_created ON sales_opportunities(tenant_id,created_at DESC,id);
ALTER TABLE sales_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunities_isolation ON sales_opportunities
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
