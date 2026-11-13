-- Commercial acceptance freezes the agreement and its titles without reserving stock.
ALTER TABLE sales_orders DROP CONSTRAINT sales_orders_status_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN ('draft', 'accepted', 'confirmed', 'completed', 'cancelled'));
