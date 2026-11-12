-- Technical information may exist before a presentation image is registered.
-- Keeping the media pointer null preserves an existing legacy product photo.
ALTER TABLE product_catalog_profiles ALTER COLUMN main_media_id DROP NOT NULL;
ALTER TABLE product_catalog_profiles
    ADD COLUMN manufacturer text NOT NULL DEFAULT '' CHECK (char_length(manufacturer) <= 80),
    ADD COLUMN manufacturer_model text NOT NULL DEFAULT '' CHECK (char_length(manufacturer_model) <= 80),
    ADD COLUMN catalog_product_name text NOT NULL DEFAULT '' CHECK (char_length(catalog_product_name) <= 200),
    ADD COLUMN live_area text NOT NULL DEFAULT '' CHECK (char_length(live_area) <= 200),
    ADD COLUMN catalog_sources jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(catalog_sources) = 'array' AND jsonb_array_length(catalog_sources) <= 10);
