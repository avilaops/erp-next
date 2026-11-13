-- Original supporting evidence is independent of signed contract bytes and money.
ALTER TABLE receivable_payments ADD COLUMN payment_method_id uuid;
ALTER TABLE receivable_payments ADD COLUMN payment_method jsonb;
ALTER TABLE receivable_payments ADD CONSTRAINT receipt_payment_method_fk
    FOREIGN KEY (tenant_id,payment_method_id) REFERENCES payment_methods(tenant_id,id);
ALTER TABLE receivable_payments ADD CONSTRAINT receipt_payment_method_snapshot
    CHECK ((payment_method_id IS NULL AND payment_method IS NULL)
        OR (payment_method_id IS NOT NULL AND jsonb_typeof(payment_method)='object'));
ALTER TABLE receivables ADD CONSTRAINT receivable_order_document_parent UNIQUE (tenant_id,order_id,id);
ALTER TABLE receivable_payments ADD CONSTRAINT receipt_document_parent UNIQUE (tenant_id,receivable_id,id);

CREATE TABLE order_supporting_documents (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    order_id uuid NOT NULL,
    receivable_id uuid,
    payment_id uuid,
    filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 180),
    media_type text NOT NULL CHECK (media_type IN ('application/pdf','image/png','image/jpeg')),
    byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content bytea NOT NULL CHECK (octet_length(content)=byte_size),
    description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 2000),
    document_date date,
    uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    uploaded_by text NOT NULL REFERENCES identities(auth_subject),
    UNIQUE (tenant_id,id),
    CHECK ((payment_id IS NULL) = (receivable_id IS NULL)),
    FOREIGN KEY (tenant_id,order_id) REFERENCES sales_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,order_id,receivable_id) REFERENCES receivables(tenant_id,order_id,id),
    FOREIGN KEY (tenant_id,receivable_id,payment_id) REFERENCES receivable_payments(tenant_id,receivable_id,id)
);
CREATE INDEX order_supporting_documents_order ON order_supporting_documents(tenant_id,order_id,uploaded_at,id);
CREATE INDEX order_supporting_documents_payment ON order_supporting_documents(tenant_id,payment_id);
CREATE FUNCTION require_original_receipt_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.payment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM receivable_payments WHERE tenant_id=NEW.tenant_id
          AND id=NEW.payment_id AND receivable_id=NEW.receivable_id AND kind='receipt'
    ) THEN
        RAISE EXCEPTION 'Supporting proof requires an original receipt';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER supporting_document_original_receipt BEFORE INSERT ON order_supporting_documents
    FOR EACH ROW EXECUTE FUNCTION require_original_receipt_document();
CREATE TRIGGER supporting_documents_append_only BEFORE UPDATE OR DELETE ON order_supporting_documents
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
ALTER TABLE order_supporting_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_supporting_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY supporting_documents_tenant ON order_supporting_documents
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON order_supporting_documents FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_next_app') THEN
        GRANT SELECT,INSERT ON order_supporting_documents TO erp_next_app;
    END IF;
END $$;
