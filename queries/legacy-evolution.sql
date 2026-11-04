-- Same authenticated transaction context required by system-configuration.sql.
-- All selections preserve source amounts; none chooses a current selling price.
PREPARE list_legacy_price_versions(uuid, integer) AS
SELECT v.id,v.book_id,b.name,v.version,v.status,v.currency_code,v.published_at,s.item_count
FROM legacy_evolution.price_versions v
JOIN legacy_evolution.price_books b ON b.tenant_id=v.tenant_id AND b.id=v.book_id
JOIN legacy_evolution.price_version_seals s ON s.tenant_id=v.tenant_id AND s.version_id=v.id
WHERE v.tenant_id=$1 AND system_config.has_permission('platform.legacy.read')
ORDER BY v.published_at DESC,v.id DESC
LIMIT least(greatest(coalesce($2,25),1),100);

PREPARE get_legacy_price_items(uuid, uuid, uuid, integer) AS
SELECT i.product_id,p.sku,p.name,i.price_cents,i.price_with_ipi_cents,i.source_history_id
FROM legacy_evolution.price_items i
JOIN public.products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id
WHERE i.tenant_id=$1 AND i.version_id=$2 AND i.product_id>coalesce($3,'00000000-0000-0000-0000-000000000000'::uuid)
    AND system_config.has_permission('platform.legacy.read')
ORDER BY i.product_id
LIMIT least(greatest(coalesce($4,25),1),100);

PREPARE list_legacy_conversion_reviews(uuid, uuid, integer) AS
SELECT history_id,source_collection,source_state,reason,rule_version
FROM legacy_evolution.record_links
WHERE tenant_id=$1 AND disposition='review_required'
    AND history_id>coalesce($2,'00000000-0000-0000-0000-000000000000'::uuid)
    AND system_config.has_permission('platform.legacy.read')
ORDER BY history_id
LIMIT least(greatest(coalesce($3,25),1),100);
