-- Additive metadata only; fiscal amounts, ledgers and tenant policies are unchanged.
ALTER TABLE fiscal_nfe_drafts ADD COLUMN ibpt_snapshot jsonb;
ALTER TABLE fiscal_nfe_drafts ADD CONSTRAINT fiscal_nfe_drafts_ibpt_snapshot_object
    CHECK (ibpt_snapshot IS NULL OR jsonb_typeof(ibpt_snapshot) = 'object');
