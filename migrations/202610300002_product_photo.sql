ALTER TABLE products ADD COLUMN photo_data_url text
    CHECK (photo_data_url IS NULL OR octet_length(photo_data_url) <= 350000);
