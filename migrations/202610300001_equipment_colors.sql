ALTER TABLE products
    ADD COLUMN structure_colors text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(structure_colors) <= 32),
    ADD COLUMN upholstery_colors text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(upholstery_colors) <= 32);

ALTER TABLE sales_order_lines
    ADD COLUMN structure_color text
        CHECK (structure_color IS NULL OR char_length(structure_color) BETWEEN 1 AND 60),
    ADD COLUMN upholstery_color text
        CHECK (upholstery_color IS NULL OR char_length(upholstery_color) BETWEEN 1 AND 60);
