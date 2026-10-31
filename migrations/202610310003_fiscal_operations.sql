-- Numbers and prepared documents survive transport failures and process restarts.
CREATE TABLE fiscal_number_sequences (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    environment text NOT NULL CHECK(environment='homologation'),
    series integer NOT NULL CHECK(series BETWEEN 1 AND 999),
    next_number bigint NOT NULL CHECK(next_number BETWEEN 1 AND 1000000000),
    PRIMARY KEY(tenant_id,environment,series)
);
CREATE TABLE fiscal_nfe_documents (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    source_order_id uuid,
    environment text NOT NULL DEFAULT 'homologation' CHECK(environment='homologation'),
    revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
    status text NOT NULL CHECK(status IN ('preparing','prepared','unknown','authorized','rejected','cancelled')),
    series integer NOT NULL CHECK(series BETWEEN 1 AND 999),
    number bigint NOT NULL CHECK(number BETWEEN 1 AND 999999999),
    issued_at text NOT NULL,
    random_code text NOT NULL CHECK(random_code ~ '^[0-9]{8}$'),
    access_key text CHECK(access_key ~ '^[0-9]{44}$'),
    signed_xml text,
    authorized_xml text,
    protocol text,
    result jsonb NOT NULL DEFAULT '{}',
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(tenant_id,id),
    FOREIGN KEY(tenant_id,id) REFERENCES fiscal_nfe_drafts(tenant_id,id),
    FOREIGN KEY(tenant_id,source_order_id) REFERENCES sales_orders(tenant_id,id),
    UNIQUE(tenant_id,environment,series,number),
    UNIQUE(tenant_id,environment,access_key),
    CHECK ((access_key IS NULL)=(signed_xml IS NULL)),
    CHECK (status NOT IN ('prepared','authorized','cancelled') OR signed_xml IS NOT NULL),
    CHECK (status NOT IN ('authorized','cancelled') OR (protocol IS NOT NULL AND authorized_xml IS NOT NULL))
);
CREATE INDEX fiscal_nfe_documents_orders ON fiscal_nfe_documents(tenant_id,source_order_id) WHERE source_order_id IS NOT NULL;
CREATE UNIQUE INDEX fiscal_nfe_documents_one_live_order ON fiscal_nfe_documents(tenant_id,source_order_id) WHERE source_order_id IS NOT NULL AND status<>'rejected';
CREATE TABLE fiscal_nfe_events (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    document_id uuid,
    kind text NOT NULL CHECK(kind IN ('cancelamento','correcao','inutilizacao')),
    sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 20),
    revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
    request jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','registered','rejected','unknown')),
    result jsonb NOT NULL DEFAULT '{}',
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(tenant_id,id),
    FOREIGN KEY(tenant_id,document_id) REFERENCES fiscal_nfe_documents(tenant_id,id)
);
CREATE UNIQUE INDEX fiscal_nfe_events_one_live_identity ON fiscal_nfe_events(tenant_id,document_id,kind,sequence) WHERE status<>'rejected';
DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['fiscal_number_sequences','fiscal_nfe_documents','fiscal_nfe_events'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    END LOOP;
END $$;
UPDATE permissions SET description='Emitir e reconciliar NF-e e eventos em homologação' WHERE code='fiscal.nfe.issue';
