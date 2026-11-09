-- Legacy publications preserve frozen costs without inventing current cost revisions.
ALTER TABLE price_table_versions
    ADD COLUMN source_kind text NOT NULL DEFAULT 'calculated'
        CHECK (source_kind IN ('calculated', 'legacy')),
    ADD COLUMN source_reference jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(source_reference) = 'object');
ALTER TABLE price_table_versions ADD CONSTRAINT legacy_price_source_required
    CHECK (source_kind <> 'legacy' OR COALESCE(
        (jsonb_typeof(source_reference->'source') = 'string'
         AND length(btrim(source_reference->>'source')) > 0
         AND source_reference ? 'version' AND source_reference ? 'historicalVersionId'), false));
ALTER TABLE price_table_items ALTER COLUMN cost_revision DROP NOT NULL;
ALTER TABLE price_table_items ADD COLUMN source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_snapshot) = 'object');

CREATE FUNCTION validate_price_item_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; source_name text;
BEGIN
    SELECT source_kind,source_reference->>'source' INTO kind,source_name FROM price_table_versions
    WHERE tenant_id=NEW.tenant_id AND id=NEW.version_id;
    IF NEW.cost_revision IS NULL AND kind IS DISTINCT FROM 'legacy' THEN
        RAISE EXCEPTION 'Only legacy price snapshots may omit a current cost revision';
    END IF;
    IF kind = 'legacy' AND (
        NEW.cost_revision IS NOT NULL
        OR NEW.source_snapshot->>'source' IS DISTINCT FROM source_name
        OR NOT (NEW.source_snapshot ?& ARRAY['advisory_cost','tax_credit','packaging','product_id','version'])
        OR NOT (NEW.cost_snapshot ?& ARRAY['purchaseCostCents','taxCreditBps','packagingCents'])
        OR jsonb_typeof(NEW.cost_snapshot->'purchaseCostCents') IS DISTINCT FROM 'number'
        OR jsonb_typeof(NEW.cost_snapshot->'taxCreditBps') IS DISTINCT FROM 'number'
        OR jsonb_typeof(NEW.cost_snapshot->'packagingCents') IS DISTINCT FROM 'number'
        OR (NEW.cost_snapshot->>'purchaseCostCents')::bigint < 0
        OR (NEW.cost_snapshot->>'packagingCents')::bigint < 0
        OR (NEW.cost_snapshot->>'taxCreditBps')::integer NOT BETWEEN 0 AND 10000
    ) THEN
        RAISE EXCEPTION 'Legacy publication requires an attributable frozen cost snapshot';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER price_item_source_guard BEFORE INSERT ON price_table_items
    FOR EACH ROW EXECUTE FUNCTION validate_price_item_source();
