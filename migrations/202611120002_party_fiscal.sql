ALTER TABLE parties ADD COLUMN fiscal jsonb;
ALTER TABLE parties ADD CONSTRAINT parties_fiscal_object CHECK (fiscal IS NULL OR jsonb_typeof(fiscal) = 'object');
