-- Fiscal return drafts/documents keep the commercial reversal that authorized
-- them without pretending that a tax treatment can be inferred from it.
ALTER TABLE fiscal_nfe_drafts
    ADD COLUMN source_return_id uuid,
    ADD COLUMN source_return_kind text;

ALTER TABLE fiscal_nfe_drafts
    ADD CONSTRAINT fiscal_nfe_drafts_return_source_check CHECK (
        (source_return_id IS NULL) = (source_return_kind IS NULL)
        AND (source_return_kind IS NULL OR source_return_kind IN ('sale_cancellation', 'purchase_reversal'))
    );

ALTER TABLE fiscal_nfe_documents
    ADD COLUMN source_return_id uuid,
    ADD COLUMN source_return_kind text;

ALTER TABLE fiscal_nfe_documents
    ADD CONSTRAINT fiscal_nfe_documents_return_source_check CHECK (
        (source_return_id IS NULL) = (source_return_kind IS NULL)
        AND (source_return_kind IS NULL OR source_return_kind IN ('sale_cancellation', 'purchase_reversal'))
    );

CREATE UNIQUE INDEX fiscal_nfe_drafts_one_return_source
    ON fiscal_nfe_drafts(tenant_id, source_return_id)
    WHERE source_return_id IS NOT NULL;

CREATE UNIQUE INDEX fiscal_nfe_documents_one_return_source
    ON fiscal_nfe_documents(tenant_id, source_return_id)
    WHERE source_return_id IS NOT NULL AND status <> 'rejected';

COMMENT ON COLUMN fiscal_nfe_drafts.source_return_kind IS
    'Commercial source: sale_cancellation or purchase_reversal; tax direction remains explicit in details.';
