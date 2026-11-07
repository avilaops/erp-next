ALTER TABLE fiscal_preferences
    DROP CONSTRAINT fiscal_preferences_section_check,
    ADD CONSTRAINT fiscal_preferences_section_check
        CHECK (section IN ('nfce', 'operation-natures', 'delivery'));
