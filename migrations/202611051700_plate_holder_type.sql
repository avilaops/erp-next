ALTER TABLE products
    ADD COLUMN plate_holder_type text NOT NULL DEFAULT ''
        CHECK (plate_holder_type IN ('', 'standard', 'olympic'));
