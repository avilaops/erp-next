-- Human-reviewed associations only; never post stock, cost or financial entries.
ALTER TABLE fiscal_cte_inspections ADD CONSTRAINT fiscal_cte_inspections_source_identity
    UNIQUE (tenant_id,document_id,id,source_xml_sha256);
CREATE TABLE fiscal_cte_commercial_links (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    inspection_id uuid NOT NULL,
    source_xml_sha256 char(64) NOT NULL CHECK (source_xml_sha256 ~ '^[0-9a-f]{64}$'),
    carrier_party_id uuid,
    carrier_tax_id text NOT NULL,
    carrier_name text NOT NULL,
    purchase_order_id uuid,
    sales_order_id uuid,
    counterparty_name text NOT NULL,
    order_amount_cents bigint NOT NULL CHECK (order_amount_cents > 0),
    order_revision bigint NOT NULL CHECK (order_revision > 0),
    freight_cents bigint NOT NULL CHECK (freight_cents BETWEEN 0 AND 999999999999999),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,document_id,id),
    FOREIGN KEY (tenant_id,document_id) REFERENCES fiscal_cte_distribution_documents(tenant_id,id),
    FOREIGN KEY (tenant_id,document_id,inspection_id,source_xml_sha256)
        REFERENCES fiscal_cte_inspections(tenant_id,document_id,id,source_xml_sha256),
    FOREIGN KEY (tenant_id,carrier_party_id) REFERENCES parties(tenant_id,id),
    FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES purchase_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,sales_order_id) REFERENCES sales_orders(tenant_id,id),
    CHECK ((purchase_order_id IS NOT NULL)::integer + (sales_order_id IS NOT NULL)::integer = 1)
);
CREATE INDEX fiscal_cte_commercial_links_document ON fiscal_cte_commercial_links(tenant_id,document_id,created_at,id);
CREATE TABLE fiscal_cte_commercial_unlinks (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    link_id uuid NOT NULL,
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,link_id),
    FOREIGN KEY (tenant_id,document_id,link_id) REFERENCES fiscal_cte_commercial_links(tenant_id,document_id,id)
);
DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['fiscal_cte_commercial_links','fiscal_cte_commercial_unlinks'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
        EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()',item);
    END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES ('fiscal.cte.link','Conferir e vincular frete CT-e a compras/vendas existentes, sem lançamentos');
