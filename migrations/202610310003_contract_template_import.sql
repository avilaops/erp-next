-- Imported drafts keep their provenance without changing the provider's original.
ALTER TABLE commercial_template_drafts ADD COLUMN source_template_id bigint;
ALTER TABLE commercial_template_drafts ADD COLUMN source_snapshot jsonb;
CREATE UNIQUE INDEX commercial_template_drafts_source
    ON commercial_template_drafts (tenant_id, source_template_id)
    WHERE source_template_id IS NOT NULL;
