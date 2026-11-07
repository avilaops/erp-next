-- Model 65 shares the durable fiscal document lifecycle with model 55, but
-- numbering is isolated by model and environment as required by the layout.
ALTER TABLE fiscal_nfe_drafts DROP CONSTRAINT IF EXISTS fiscal_nfe_drafts_model_check;
ALTER TABLE fiscal_nfe_drafts ADD CONSTRAINT fiscal_nfe_drafts_model_check CHECK (model IN (55, 65));

ALTER TABLE fiscal_number_sequences ADD COLUMN model smallint NOT NULL DEFAULT 55;
ALTER TABLE fiscal_number_sequences ADD CONSTRAINT fiscal_number_sequences_model_check CHECK (model IN (55, 65));
ALTER TABLE fiscal_number_sequences DROP CONSTRAINT IF EXISTS fiscal_number_sequences_pkey;
ALTER TABLE fiscal_number_sequences ADD PRIMARY KEY (tenant_id, environment, model, series);

ALTER TABLE fiscal_nfe_documents ADD COLUMN model smallint NOT NULL DEFAULT 55;
ALTER TABLE fiscal_nfe_documents ADD CONSTRAINT fiscal_nfe_documents_model_check CHECK (model IN (55, 65));
ALTER TABLE fiscal_nfe_documents DROP CONSTRAINT IF EXISTS fiscal_nfe_documents_tenant_id_environment_series_number_key;
ALTER TABLE fiscal_nfe_documents ADD CONSTRAINT fiscal_nfe_documents_tenant_environment_model_series_number_key UNIQUE (tenant_id, environment, model, series, number);

COMMENT ON COLUMN fiscal_number_sequences.model IS 'Modelo fiscal: 55 NF-e ou 65 NFC-e';
COMMENT ON COLUMN fiscal_nfe_documents.model IS 'Modelo fiscal: 55 NF-e ou 65 NFC-e';
