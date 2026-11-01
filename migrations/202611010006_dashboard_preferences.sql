ALTER TABLE personal_preferences
    ADD COLUMN dashboard_layout jsonb NOT NULL DEFAULT
    '{"favoritePaths":["/vendas/pedidos","/compras/pedidos","/cadastros/clientes-fornecedores","/cadastros/produtos","/financeiro/contas-receber"],"charts":["Ticket médio","Valor faturado"],"period":"6M"}'::jsonb
    CHECK (jsonb_typeof(dashboard_layout) = 'object');
