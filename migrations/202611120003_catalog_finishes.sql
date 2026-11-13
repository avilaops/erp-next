-- Add independent swing-arm choices without reinterpreting legacy holder colors.
-- Existing documents and catalog choices remain unchanged.
ALTER TABLE products
    ADD COLUMN swing_arm_colors text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(swing_arm_colors) <= 32),
    ADD COLUMN finishing_palette text NOT NULL DEFAULT ''
        CHECK (finishing_palette IN ('', 'dhz-hammerforce-pro', 'dhz-sforce'));

ALTER TABLE sales_order_lines
    ADD COLUMN swing_arm_color text
        CHECK (swing_arm_color IS NULL OR char_length(swing_arm_color) BETWEEN 1 AND 60);

ALTER TABLE sales_proposal_lines
    ADD COLUMN swing_arm_color text
        CHECK (swing_arm_color IS NULL OR char_length(swing_arm_color) BETWEEN 1 AND 60);
