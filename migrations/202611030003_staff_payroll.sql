-- Employee records and payroll liabilities; no bank transfer is executed.
ALTER TABLE staff ADD COLUMN profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile)='object');
CREATE TABLE staff_payroll_profiles (
 tenant_id uuid NOT NULL, staff_id uuid NOT NULL, revision bigint NOT NULL DEFAULT 1,
 settings jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,staff_id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff(tenant_id,id)
);
CREATE TABLE staff_payroll_requests (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, staff_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('settings','payment')),
 payload jsonb NOT NULL, base_revision bigint NOT NULL, revision bigint NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 requested_by text NOT NULL, reviewed_by text, review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff(tenant_id,id)
);
CREATE TABLE staff_payroll_obligations (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, staff_id uuid NOT NULL,
 source_request_id uuid NOT NULL, competence date NOT NULL, kind text NOT NULL CHECK(kind IN ('salary','one_off')),
 category text NOT NULL, note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff(tenant_id,id),
 FOREIGN KEY(tenant_id,source_request_id) REFERENCES staff_payroll_requests(tenant_id,id)
);
CREATE UNIQUE INDEX staff_salary_month ON staff_payroll_obligations(tenant_id,staff_id,competence) WHERE kind='salary';
ALTER TABLE payables ALTER COLUMN receipt_id DROP NOT NULL;
ALTER TABLE payables ADD COLUMN staff_obligation_id uuid;
ALTER TABLE payables ADD CONSTRAINT payables_staff_fk FOREIGN KEY(tenant_id,staff_obligation_id) REFERENCES staff_payroll_obligations(tenant_id,id);
ALTER TABLE payables ADD CONSTRAINT payables_one_origin CHECK(num_nonnulls(receipt_id,staff_obligation_id)=1);
CREATE UNIQUE INDEX payables_staff_origin ON payables(tenant_id,staff_obligation_id) WHERE staff_obligation_id IS NOT NULL;
CREATE INDEX staff_payroll_request_queue ON staff_payroll_requests(tenant_id,status,created_at DESC);
ALTER TABLE staff_payroll_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_payroll_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_payroll_profiles
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE staff_payroll_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_payroll_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_payroll_requests
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE staff_payroll_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_payroll_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_payroll_obligations
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
INSERT INTO permissions(code,description) VALUES
 ('finance.staff.read','Consultar salários, dados de pagamento e histórico de funcionários'),
 ('finance.staff.manage','Propor salário, Pix, recorrência e pagamentos de funcionários'),
 ('finance.staff.approve','Aprovar ou rejeitar alterações financeiras e desligar funcionários com pagamentos');
-- Existing administrators retain complete authority; other roles receive no payroll access.
INSERT INTO role_permissions(role_id,permission_code)
 SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='administrator' AND p.code LIKE 'finance.staff.%' ON CONFLICT DO NOTHING;
-- Narrow background discovery: only tenant identifiers with an explicitly approved recurrence.
-- No personal data or application mutation is exposed by this definer function.
CREATE FUNCTION erp_staff_payroll_due_tenants() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT p.tenant_id FROM public.staff_payroll_profiles p
 JOIN public.staff s ON s.tenant_id=p.tenant_id AND s.id=p.staff_id
 WHERE p.settings->>'recurring'='true' AND s.status='active' AND s.is_employee
$$;
REVOKE ALL ON FUNCTION erp_staff_payroll_due_tenants() FROM PUBLIC;
