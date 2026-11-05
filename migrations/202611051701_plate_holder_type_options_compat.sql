UPDATE products
SET plate_holder_types = CASE plate_holder_type
    WHEN 'standard' THEN ARRAY['Standard']::text[]
    WHEN 'olympic' THEN ARRAY['Olímpico']::text[]
    ELSE plate_holder_types
END
WHERE cardinality(plate_holder_types) = 0
  AND plate_holder_type IN ('standard', 'olympic');
