-- Primary strength ignores case/accents; numeric ordering matches displayed names.
CREATE COLLATION public.erp_pt_br_natural (
    provider = icu,
    locale = 'pt-BR-u-ks-level1-kn-true',
    deterministic = false
);
