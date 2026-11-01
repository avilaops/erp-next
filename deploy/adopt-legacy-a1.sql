-- Operator-only adoption after prepare_legacy_a1 has validated and resealed the A1.
-- The caller supplies exactly one JSON row in the session-local table
-- a1_adoption_input(payload jsonb), including prepared, legacyCertificateId,
-- legacySchema and actorIdentityId. Never put PFX/password/keyring in this row.
BEGIN;
DO $$
DECLARE
    input jsonb;
    prepared jsonb;
    certificate jsonb;
    tenant uuid;
    actor uuid;
    tax_id text;
    current_revision bigint;
    next_revision bigint;
    configured boolean;
    details jsonb;
BEGIN
    IF (SELECT count(*) FROM a1_adoption_input) <> 1 THEN
        RAISE EXCEPTION 'Exactly one prepared certificate is required';
    END IF;
    SELECT payload INTO STRICT input FROM a1_adoption_input;
    prepared := input->'prepared';
    certificate := prepared->'metadata';
    tenant := (prepared->>'tenantId')::uuid;
    actor := (input->>'actorIdentityId')::uuid;
    next_revision := (prepared->>'revision')::bigint;

    SELECT t.tax_id INTO STRICT tax_id FROM tenants t
        WHERE t.id = tenant AND t.status = 'active' FOR UPDATE;
    IF certificate->>'taxId' IS DISTINCT FROM tax_id
        OR certificate->>'chainVerified' IS DISTINCT FROM 'true'
        OR NOT coalesce(
            (certificate->>'validFrom')::bigint <= extract(epoch FROM clock_timestamp())
            AND (certificate->>'validUntil')::bigint > extract(epoch FROM clock_timestamp()), false
        ) THEN
        RAISE EXCEPTION 'Prepared certificate does not match the active company or validity';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenant_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id AND r.tenant_id = m.tenant_id
        JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.tenant_id = tenant AND m.identity_id = actor AND m.status = 'active'
            AND rp.permission_code = 'fiscal.config.manage'
    ) THEN
        RAISE EXCEPTION 'Responsible operator has no active fiscal configuration permission';
    END IF;
    IF input->>'legacySchema' IS DISTINCT FROM 'tenant_ludus' OR NOT EXISTS (
        SELECT 1 FROM tenant_ludus.fiscal_certificates source
        WHERE source.id::text = input->>'legacyCertificateId'
            AND source.holder_cnpj = tax_id
            AND source.fingerprint = certificate->>'fingerprint'
    ) THEN
        RAISE EXCEPTION 'Legacy certificate provenance does not match';
    END IF;

    SELECT revision, metadata IS NOT NULL INTO current_revision, configured
        FROM fiscal_a1_certificates WHERE tenant_id = tenant FOR UPDATE;
    IF configured OR next_revision IS DISTINCT FROM coalesce(current_revision, 0) + 1 THEN
        RAISE EXCEPTION 'Destination certificate exists or its revision changed';
    END IF;
    INSERT INTO fiscal_a1_certificates(
        tenant_id, revision, metadata, encryption_key_id, nonce, ciphertext,
        updated_by_identity_id
    ) VALUES (
        tenant, next_revision, certificate, prepared->>'encryptionKeyId',
        decode(prepared->>'nonce', 'base64'), decode(prepared->>'ciphertext', 'base64'), actor
    ) ON CONFLICT (tenant_id) DO UPDATE SET
        revision = excluded.revision, metadata = excluded.metadata,
        encryption_key_id = excluded.encryption_key_id, nonce = excluded.nonce,
        ciphertext = excluded.ciphertext, updated_by_identity_id = excluded.updated_by_identity_id,
        updated_at = clock_timestamp();

    details := jsonb_build_object(
        'revision', next_revision, 'fingerprint', certificate->>'fingerprint',
        'validUntil', (certificate->>'validUntil')::bigint,
        'source', 'legacy_a1_adoption', 'legacySchema', input->>'legacySchema',
        'legacyCertificateId', input->>'legacyCertificateId'
    );
    INSERT INTO audit_log(tenant_id, identity_id, action, entity_type, entity_id, details)
        VALUES (tenant, actor, 'fiscal.certificate.migrated', 'fiscal_certificate', tenant::text, details);
    INSERT INTO outbox_events(tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES (tenant, 'fiscal_certificate', tenant::text, 'fiscal.certificate.migrated', details);
END;
$$;
COMMIT;
