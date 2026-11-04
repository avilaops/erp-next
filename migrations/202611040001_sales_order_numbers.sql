-- Commercial numbers are immutable and allocated transactionally per tenant.
ALTER TABLE sales_orders ADD COLUMN number bigint;
CREATE TABLE sales_order_counters (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    last_number bigint NOT NULL CHECK (last_number > 0)
);
ALTER TABLE sales_order_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order_counters
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The migration owner also obeys FORCE RLS. Discover tenants only while migrating.
DO $migration$
DECLARE tenant uuid; previous_tenant text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
    EXECUTE format('CREATE POLICY order_number_migration_scan ON tenants FOR SELECT TO %I USING (true)', current_user);
    FOR tenant IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', tenant::text, true);
        WITH numbered AS (
            SELECT id, row_number() OVER (ORDER BY created_at, id) AS number
            FROM sales_orders WHERE tenant_id = tenant
        )
        UPDATE sales_orders o SET number = n.number FROM numbered n
        WHERE o.tenant_id = tenant AND o.id = n.id;
        INSERT INTO sales_order_counters(tenant_id, last_number)
            SELECT tenant, max(number) FROM sales_orders WHERE tenant_id = tenant
            HAVING max(number) IS NOT NULL;
    END LOOP;
    PERFORM set_config('app.tenant_id', previous_tenant, true);
    DROP POLICY order_number_migration_scan ON tenants;
END
$migration$;

ALTER TABLE sales_orders ALTER COLUMN number SET NOT NULL;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_number_positive CHECK (number > 0);
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_tenant_number_unique UNIQUE (tenant_id, number);

CREATE FUNCTION assign_sales_order_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.number IS DISTINCT FROM OLD.number OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
            RAISE EXCEPTION 'Order number and tenant are immutable';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.number IS NOT NULL THEN
        RAISE EXCEPTION 'Order number is assigned automatically';
    END IF;
    INSERT INTO sales_order_counters(tenant_id, last_number) VALUES (NEW.tenant_id, 1)
        ON CONFLICT (tenant_id) DO UPDATE
        SET last_number = sales_order_counters.last_number + 1
        RETURNING last_number INTO NEW.number;
    RETURN NEW;
END
$$;
CREATE TRIGGER sales_order_number BEFORE INSERT OR UPDATE ON sales_orders
    FOR EACH ROW EXECUTE FUNCTION assign_sales_order_number();

-- Keep inserts from the previous API image working immediately after commit.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_next_app') THEN
        GRANT SELECT, INSERT, UPDATE ON sales_order_counters TO erp_next_app;
    END IF;
END
$$;
