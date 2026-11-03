-- Register independent commands without expanding any existing role's access.
INSERT INTO permissions(code, description) VALUES
    ('fiscal.nfe.cancel', 'Cancelar NF-e da empresa em homologação'),
    ('fiscal.nfe.correction', 'Registrar carta de correção de NF-e em homologação'),
    ('fiscal.nfe.void', 'Inutilizar numeração de NF-e em homologação'),
    ('fiscal.certificate.manage', 'Conectar, substituir e remover certificado A1 da empresa')
ON CONFLICT (code) DO NOTHING;

UPDATE permissions
SET description = 'Emitir e reconciliar emissão de NF-e em homologação'
WHERE code = 'fiscal.nfe.issue';
