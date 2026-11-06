ALTER TABLE warranty_cases
    ADD COLUMN queue text NOT NULL DEFAULT 'general'
        CHECK (char_length(btrim(queue)) BETWEEN 1 AND 80);

ALTER TABLE warranty_cases
    ADD CONSTRAINT warranty_cases_assigned_staff_fk
    FOREIGN KEY (tenant_id, assigned_to) REFERENCES staff(tenant_id, id);

CREATE INDEX warranty_cases_triage_queue_idx
    ON warranty_cases(tenant_id, queue, status, updated_at DESC, id DESC);
