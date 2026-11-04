-- Additive structures. Historical conversion never replays business commands.
CREATE UNIQUE INDEX legacy_files_history_idx ON public.legacy_files(tenant_id, history_id, id);
CREATE SCHEMA legacy_evolution;
REVOKE ALL ON SCHEMA legacy_evolution FROM PUBLIC;

CREATE TABLE legacy_evolution.price_books (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 100),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    source_line_key text,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE legacy_evolution.price_versions (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    book_id uuid NOT NULL,
    version bigint NOT NULL CHECK (version > 0),
    status text NOT NULL CHECK (status IN ('historical', 'published')),
    currency_code text CHECK (currency_code ~ '^[A-Z]{3}$'),
    effective_from timestamptz,
    effective_until timestamptz,
    published_at timestamptz NOT NULL,
    parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
    source_history_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, book_id, version),
    UNIQUE (tenant_id, source_history_id),
    FOREIGN KEY (tenant_id, book_id) REFERENCES legacy_evolution.price_books(tenant_id, id),
    FOREIGN KEY (tenant_id, source_history_id) REFERENCES public.legacy_history(tenant_id, id),
    CHECK (effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until > effective_from)),
    CHECK (status <> 'published' OR (currency_code IS NOT NULL AND effective_from IS NOT NULL)),
    CHECK (status <> 'historical' OR source_history_id IS NOT NULL)
);

CREATE TABLE legacy_evolution.price_items (
    tenant_id uuid NOT NULL,
    version_id uuid NOT NULL,
    product_id uuid NOT NULL,
    price_cents bigint NOT NULL CHECK (price_cents >= 0),
    price_with_ipi_cents bigint CHECK (price_with_ipi_cents >= 0),
    source_history_id uuid,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    PRIMARY KEY (tenant_id, version_id, product_id),
    UNIQUE (tenant_id, source_history_id),
    FOREIGN KEY (tenant_id, version_id) REFERENCES legacy_evolution.price_versions(tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id),
    FOREIGN KEY (tenant_id, source_history_id) REFERENCES public.legacy_history(tenant_id, id)
);
CREATE INDEX price_items_product_idx ON legacy_evolution.price_items(tenant_id, product_id, version_id);

CREATE TABLE legacy_evolution.price_version_seals (
    tenant_id uuid NOT NULL,
    version_id uuid NOT NULL,
    item_count bigint NOT NULL CHECK (item_count > 0),
    sealed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, version_id),
    FOREIGN KEY (tenant_id, version_id) REFERENCES legacy_evolution.price_versions(tenant_id, id)
);
CREATE FUNCTION legacy_evolution.guard_price_items() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    PERFORM 1 FROM legacy_evolution.price_versions WHERE tenant_id=NEW.tenant_id AND id=NEW.version_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM legacy_evolution.price_version_seals WHERE tenant_id=NEW.tenant_id AND version_id=NEW.version_id) THEN
        RAISE EXCEPTION 'Sealed price versions cannot receive additional items' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER price_items_sealed BEFORE INSERT ON legacy_evolution.price_items
    FOR EACH ROW EXECUTE FUNCTION legacy_evolution.guard_price_items();
CREATE FUNCTION legacy_evolution.seal_price_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    PERFORM 1 FROM legacy_evolution.price_versions WHERE tenant_id=NEW.tenant_id AND id=NEW.version_id FOR UPDATE;
    SELECT count(*) INTO NEW.item_count FROM legacy_evolution.price_items WHERE tenant_id=NEW.tenant_id AND version_id=NEW.version_id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER price_version_seal_count BEFORE INSERT ON legacy_evolution.price_version_seals
    FOR EACH ROW EXECUTE FUNCTION legacy_evolution.seal_price_version();

CREATE TABLE legacy_evolution.product_cost_snapshots (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    source_history_id uuid NOT NULL,
    advisory_cost_cents bigint CHECK (advisory_cost_cents >= 0),
    packaging_cents bigint CHECK (packaging_cents >= 0),
    tax_credit numeric(10,8) CHECK (tax_credit BETWEEN 0 AND 1),
    supplier_price_usd numeric(12,2) CHECK (supplier_price_usd >= 0),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, source_history_id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id),
    FOREIGN KEY (tenant_id, source_history_id) REFERENCES public.legacy_history(tenant_id, id)
);
CREATE INDEX product_cost_snapshots_product_idx ON legacy_evolution.product_cost_snapshots(tenant_id, product_id, recorded_at DESC, id DESC);

CREATE TABLE legacy_evolution.product_attribute_snapshots (
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    source_history_id uuid NOT NULL,
    description text,
    supplier_name text,
    supplier_model text,
    length_mm integer CHECK (length_mm > 0),
    width_mm integer CHECK (width_mm > 0),
    height_mm integer CHECK (height_mm > 0),
    weight_kg numeric(8,2) CHECK (weight_kg > 0),
    source_line_key text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, product_id, source_history_id),
    UNIQUE (tenant_id, source_history_id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id),
    FOREIGN KEY (tenant_id, source_history_id) REFERENCES public.legacy_history(tenant_id, id)
);

CREATE TABLE legacy_evolution.file_references (
    tenant_id uuid NOT NULL,
    legacy_file_id uuid NOT NULL,
    product_id uuid,
    history_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, legacy_file_id),
    FOREIGN KEY (tenant_id, history_id, legacy_file_id) REFERENCES public.legacy_files(tenant_id, history_id, id),
    FOREIGN KEY (tenant_id, history_id) REFERENCES public.legacy_history(tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id)
);
CREATE INDEX legacy_product_files_idx ON legacy_evolution.file_references(tenant_id, product_id, legacy_file_id) WHERE product_id IS NOT NULL;

CREATE TABLE legacy_evolution.record_links (
    tenant_id uuid NOT NULL,
    history_id uuid NOT NULL,
    source_schema text NOT NULL CHECK (source_schema = 'tenant_ludus'),
    source_collection text NOT NULL,
    source_key jsonb NOT NULL CHECK (jsonb_typeof(source_key) = 'object'),
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    rule_version integer NOT NULL CHECK (rule_version > 0),
    disposition text NOT NULL CHECK (disposition IN ('linked', 'history_only', 'review_required')),
    source_state text,
    product_id uuid,
    party_id uuid,
    price_version_id uuid,
    reason text NOT NULL CHECK (char_length(btrim(reason)) > 0),
    reconciled_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, history_id),
    FOREIGN KEY (tenant_id, history_id) REFERENCES public.legacy_history(tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id),
    FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id),
    FOREIGN KEY (tenant_id, price_version_id) REFERENCES legacy_evolution.price_versions(tenant_id, id),
    CHECK (disposition <> 'linked' OR num_nonnulls(product_id, party_id, price_version_id) > 0)
);
CREATE INDEX legacy_link_review_idx ON legacy_evolution.record_links(tenant_id, source_collection, history_id) WHERE disposition = 'review_required';

-- Future orders can record an explicitly selected published version; historical
-- orders are deliberately not matched by date, customer, amount or row count.
CREATE TABLE legacy_evolution.order_price_versions (
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    version_id uuid NOT NULL,
    selected_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, order_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES public.sales_orders(tenant_id, id),
    FOREIGN KEY (tenant_id, version_id) REFERENCES legacy_evolution.price_versions(tenant_id, id)
);
CREATE FUNCTION legacy_evolution.validate_order_price_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM legacy_evolution.price_versions v
        JOIN legacy_evolution.price_version_seals s ON s.tenant_id=v.tenant_id AND s.version_id=v.id
        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.version_id AND v.status = 'published'
        AND v.effective_from <= NEW.selected_at AND (v.effective_until IS NULL OR NEW.selected_at < v.effective_until)) THEN
        RAISE EXCEPTION 'An order requires an explicitly published effective price version' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER order_price_version_valid BEFORE INSERT ON legacy_evolution.order_price_versions
    FOR EACH ROW EXECUTE FUNCTION legacy_evolution.validate_order_price_version();

DO $$
DECLARE relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY['price_books','price_versions','price_items',
        'price_version_seals','product_cost_snapshots','product_attribute_snapshots','file_references','record_links','order_price_versions'] LOOP
        EXECUTE format('ALTER TABLE legacy_evolution.%I ENABLE ROW LEVEL SECURITY', relation_name);
        EXECUTE format('ALTER TABLE legacy_evolution.%I FORCE ROW LEVEL SECURITY', relation_name);
        EXECUTE format('CREATE POLICY tenant_isolation ON legacy_evolution.%I USING
            (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)
            WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', relation_name);
        EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON legacy_evolution.%I
            FOR EACH ROW EXECUTE FUNCTION public.reject_audit_log_changes()', relation_name);
    END LOOP;
END;
$$;

CREATE VIEW system_config.file_catalog WITH (security_invoker = true) AS
SELECT tenant_id, id, 'system'::text AS origin, original_name AS filename, media_type,
       byte_size, sha256, status, created_at
FROM system_config.files
UNION ALL
SELECT f.tenant_id, f.id, 'legacy'::text, f.filename, f.media_type,
       octet_length(f.content)::bigint, f.sha256, 'available'::text, h.imported_at
FROM public.legacy_files f
JOIN public.legacy_history h ON h.tenant_id = f.tenant_id AND h.id = f.history_id;
COMMENT ON VIEW system_config.file_catalog IS
    'Metadata only. Original binaries stay immutable. Consumers must authorize each origin and use its authenticated download endpoint.';

REVOKE ALL ON ALL TABLES IN SCHEMA legacy_evolution FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA legacy_evolution FROM PUBLIC;
