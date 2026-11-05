-- Components are independent choices; existing upholstery selections remain intact.
ALTER TABLE products
    ADD COLUMN plate_holder_colors text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(plate_holder_colors) <= 32),
    ADD COLUMN plate_holder_types text[] NOT NULL DEFAULT '{}'
        CHECK (
            cardinality(plate_holder_types) <= 2
            AND plate_holder_types <@ ARRAY['Olímpico', 'Standard']::text[]
        );

ALTER TABLE sales_order_lines
    ADD COLUMN plate_holder_color text
        CHECK (plate_holder_color IS NULL OR char_length(plate_holder_color) BETWEEN 1 AND 60),
    ADD COLUMN plate_holder_type text
        CHECK (plate_holder_type IS NULL OR plate_holder_type IN ('Olímpico', 'Standard'));

ALTER TABLE sales_proposal_lines
    ADD COLUMN plate_holder_color text
        CHECK (plate_holder_color IS NULL OR char_length(plate_holder_color) BETWEEN 1 AND 60),
    ADD COLUMN plate_holder_type text
        CHECK (plate_holder_type IS NULL OR plate_holder_type IN ('Olímpico', 'Standard'));
