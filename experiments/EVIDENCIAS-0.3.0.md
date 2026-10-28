# Verificação local da versão 0.3.0

Escopo: `D:/Projetos/SaaS/erp-next/experiments`. Não houve deploy ou
publicação externa. As alterações ficaram no pacote de experimentos;
as modificações preexistentes do ERP não foram alteradas.

## Resultados

- Base 0.2.0 antes da alteração: 33 testes aprovados.
- `npm test` na 0.3.0: 54 aprovados; zero falhas ou testes ignorados.
- `npm run test:custom`: candidata aprovada em 14/14; base em 6/14.
  Comparação permitida, sem regressões nesse conjunto de desenvolvimento.
- `npm run test:path`: seis resultados esperados reconhecidos; um aprovado,
  quatro reprovados e um inconclusivo. Todos produzem o número 12, aprovado
  pelo gate numérico, demonstrando a independência da política de caminho.
- `npm pack --json`: pacote 0.3.0 gerado com código e declarações.
- Instalação do tarball no consumidor separado com
  `npm install --ignore-scripts --offline --no-audit --no-fund`: aprovada.
- `node smoke.mjs` no consumidor: importação do pacote instalado aprovada,
  incluindo limites exclusivos e `pathFidelity`.
- Tipos do consumidor: compilação sem emissão aprovada usando TypeScript 6
  com `--ignoreConfig --strict --skipLibCheck --target ES2023 --module NodeNext
  --moduleResolution NodeNext smoke.ts`.

## Artefatos

- Pacote: `avilaops-experiments-0.3.0.tgz`.
- SHA-256: `b7196581b4ceff2ff180505390a7402dbf457958425c02c53749c4d82e4ba1b9`.
- Relatórios numéricos:
  `reports/custom-tests/6c598b41-bca9-409d-87d2-138978505c4a/`.
- Relatório de caminho:
  `reports/path-policy/7c7c9eb9-a079-4740-8812-dabda677e043/report.json`.
- Pacotes e arquivos-fonte 0.1.0 e 0.2.0 preservados.

## Limites

Os cenários de caminho são simulações locais com chamadas instrumentadas,
sem integração operacional com THESEUS, ERP ou modelos. Autenticidade e
completude do trace precisam ser garantidas pelo executor real. A cópia de
JSON não é sandbox. Ausência de regressões nesse conjunto não autoriza deploy.

A publicação pública depende da definição solicitada ao usuário: código e
documentação, página de resultados ou serviços Annif/Ultralytics.
