# Servidor da web

`auth/` controla sessão e configuração privada. `bff/` encaminha chamadas
autenticadas com as validações específicas de cada serviço. Todos os módulos
executáveis precisam importar `server-only`.

Regras de negócio e persistência pertencem à API Rust. Código cliente não pode
importar esta árvore, nem por um módulo intermediário. O CI verifica esse limite.
Consulte o [mapa completo](../../../../architecture/README.md).
