-- Components are independent choices; existing upholstery selections remain intact.
ALTER TABLE products
    ADD COLUMN arm_colors text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(arm_colors) <= 32),
    ADD COLUMN plate_holder_colors text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(plate_holder_colors) <= 32);

ALTER TABLE sales_order_lines
    ADD COLUMN arm_color text
        CHECK (arm_color IS NULL OR char_length(arm_color) BETWEEN 1 AND 60),
    ADD COLUMN plate_holder_color text
        CHECK (plate_holder_color IS NULL OR char_length(plate_holder_color) BETWEEN 1 AND 60);

ALTER TABLE sales_proposal_lines
    ADD COLUMN arm_color text
        CHECK (arm_color IS NULL OR char_length(arm_color) BETWEEN 1 AND 60),
    ADD COLUMN plate_holder_color text
        CHECK (plate_holder_color IS NULL OR char_length(plate_holder_color) BETWEEN 1 AND 60);
