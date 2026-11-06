ALTER TABLE products
    ADD COLUMN plate_holder_types text[] NOT NULL DEFAULT '{}'
        CHECK (
            cardinality(plate_holder_types) <= 2
            AND plate_holder_types <@ ARRAY['Olímpico', 'Standard']::text[]
        );

ALTER TABLE sales_order_lines
    ADD COLUMN plate_holder_type text
        CHECK (plate_holder_type IS NULL OR plate_holder_type IN ('Olímpico', 'Standard'));

ALTER TABLE sales_proposal_lines
    ADD COLUMN plate_holder_type text
        CHECK (plate_holder_type IS NULL OR plate_holder_type IN ('Olímpico', 'Standard'));
