-- Same tenant-owned row and revision as the party; no independent access path.
ALTER TABLE parties
    ADD COLUMN addresses jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(addresses) = 'array' AND jsonb_array_length(addresses) <= 10),
    ADD COLUMN contacts jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(contacts) = 'array' AND jsonb_array_length(contacts) <= 10);
