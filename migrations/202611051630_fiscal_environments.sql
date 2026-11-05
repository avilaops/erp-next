-- Expose both environments without changing any company's chosen environment.
ALTER TABLE fiscal_profiles DROP CONSTRAINT fiscal_profiles_environment_check;
ALTER TABLE fiscal_profiles ADD CHECK (environment IN ('homologation','production'));
ALTER TABLE fiscal_nfe_drafts DROP CONSTRAINT fiscal_nfe_drafts_environment_check;
ALTER TABLE fiscal_nfe_drafts ADD CHECK (environment IN ('homologation','production'));
ALTER TABLE fiscal_number_sequences DROP CONSTRAINT fiscal_number_sequences_environment_check;
ALTER TABLE fiscal_number_sequences ADD CHECK (environment IN ('homologation','production'));
ALTER TABLE fiscal_nfe_documents DROP CONSTRAINT fiscal_nfe_documents_environment_check;
ALTER TABLE fiscal_nfe_documents ADD CHECK (environment IN ('homologation','production'));
ALTER TABLE fiscal_nfe_drafts ADD UNIQUE (tenant_id,id,environment);
ALTER TABLE fiscal_nfe_documents ADD FOREIGN KEY (tenant_id,id,environment)
    REFERENCES fiscal_nfe_drafts(tenant_id,id,environment);
DROP INDEX fiscal_nfe_documents_one_live_order;
CREATE UNIQUE INDEX fiscal_nfe_documents_one_live_order
    ON fiscal_nfe_documents(tenant_id,source_order_id,environment)
    WHERE source_order_id IS NOT NULL AND status<>'rejected';
