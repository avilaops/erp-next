CREATE TABLE sales_proposals (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    number bigint GENERATED ALWAYS AS IDENTITY,
    current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    order_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, number),
    UNIQUE (tenant_id, order_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id)
);

CREATE TABLE sales_proposal_versions (
    tenant_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    customer_id uuid NOT NULL,
    customer_name text NOT NULL,
    customer_tax_id text NOT NULL,
    valid_until date NOT NULL,
    payment_terms text NOT NULL CHECK (char_length(btrim(payment_terms)) BETWEEN 1 AND 2000),
    delivery_terms text NOT NULL CHECK (char_length(btrim(delivery_terms)) BETWEEN 1 AND 2000),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'cancelled', 'superseded')),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    decided_at timestamptz,
    decided_by text,
    decision_reason text CHECK (char_length(decision_reason) <= 2000),
    PRIMARY KEY (tenant_id, proposal_id, version),
    FOREIGN KEY (tenant_id, proposal_id) REFERENCES sales_proposals(tenant_id, id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES parties(tenant_id, id),
    CHECK (status NOT IN ('sent', 'accepted', 'rejected') OR sent_at IS NOT NULL),
    CHECK (status NOT IN ('accepted', 'rejected', 'cancelled')
        OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
    CHECK (status NOT IN ('rejected', 'cancelled')
        OR (decision_reason IS NOT NULL AND char_length(btrim(decision_reason)) > 0))
);

ALTER TABLE sales_proposals ADD CONSTRAINT sales_proposals_current_version_fk
    FOREIGN KEY (tenant_id, id, current_version)
    REFERENCES sales_proposal_versions(tenant_id, proposal_id, version)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sales_proposal_lines (
    tenant_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    version integer NOT NULL,
    line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 100),
    product_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    catalog_price_cents bigint NOT NULL CHECK (catalog_price_cents BETWEEN 0 AND 99999999999999),
    price_cents bigint NOT NULL CHECK (price_cents BETWEEN 0 AND 99999999999999),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999999999),
    structure_color text,
    upholstery_color text,
    PRIMARY KEY (tenant_id, proposal_id, version, line_number),
    UNIQUE (tenant_id, proposal_id, version, product_id),
    FOREIGN KEY (tenant_id, proposal_id, version)
        REFERENCES sales_proposal_versions(tenant_id, proposal_id, version),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
    CHECK (amount_cents = floor((quantity_micros::numeric * price_cents + 500000) / 1000000))
);

CREATE INDEX sales_proposals_created_idx ON sales_proposals(tenant_id, created_at DESC, id DESC);
CREATE INDEX sales_proposal_versions_customer_idx ON sales_proposal_versions(tenant_id, customer_id);
CREATE INDEX sales_proposal_versions_status_idx ON sales_proposal_versions(tenant_id, status, valid_until);

-- Once a version leaves draft, its commercial contents are historical evidence.
CREATE FUNCTION protect_proposal_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Proposal versions cannot be deleted';
    END IF;
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.proposal_id <> OLD.proposal_id OR NEW.version <> OLD.version THEN
        RAISE EXCEPTION 'Proposal version identity is immutable';
    END IF;
    IF OLD.status <> 'draft' AND (
        NEW.customer_id, NEW.customer_name, NEW.customer_tax_id, NEW.valid_until,
        NEW.payment_terms, NEW.delivery_terms, NEW.notes, NEW.amount_cents,
        NEW.created_by, NEW.created_at
    ) IS DISTINCT FROM (
        OLD.customer_id, OLD.customer_name, OLD.customer_tax_id, OLD.valid_until,
        OLD.payment_terms, OLD.delivery_terms, OLD.notes, OLD.amount_cents,
        OLD.created_by, OLD.created_at
    ) THEN
        RAISE EXCEPTION 'Published proposal contents are immutable';
    END IF;
    IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'Create a new version to revise a published proposal';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sales_proposal_version_guard BEFORE UPDATE OR DELETE ON sales_proposal_versions
    FOR EACH ROW EXECUTE FUNCTION protect_proposal_version();

CREATE FUNCTION protect_proposal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    version_status text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        SELECT status INTO version_status FROM sales_proposal_versions
        WHERE tenant_id=OLD.tenant_id AND proposal_id=OLD.proposal_id AND version=OLD.version FOR UPDATE;
        IF version_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'Published proposal lines are immutable';
        END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        SELECT status INTO version_status FROM sales_proposal_versions
        WHERE tenant_id=NEW.tenant_id AND proposal_id=NEW.proposal_id AND version=NEW.version FOR UPDATE;
        IF version_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'Proposal lines require a draft version';
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER sales_proposal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_proposal_lines
    FOR EACH ROW EXECUTE FUNCTION protect_proposal_line();

ALTER TABLE sales_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_proposals_isolation ON sales_proposals
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE sales_proposal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_proposal_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_proposal_versions_isolation ON sales_proposal_versions
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE sales_proposal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_proposal_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_proposal_lines_isolation ON sales_proposal_lines
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('sales.proposals.read', 'Consultar propostas e versões da empresa'),
    ('sales.proposals.manage', 'Criar, editar, versionar e cancelar propostas da empresa'),
    ('sales.proposals.decide', 'Registrar aceite e rejeição de propostas da empresa'),
    ('sales.proposals.negotiate', 'Definir preços comerciais nas propostas da empresa')
ON CONFLICT (code) DO NOTHING;
