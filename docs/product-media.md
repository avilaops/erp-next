# Product category and media registry

Products reference a category belonging to the same tenant. The API accepts
`categoryId`: a category UUID assigns it, an empty string clears it, and omission
preserves the previous assignment on updates. New assignments require an active
category. Product lists accept `category_id` and apply it to rows and totals.

`product_media_assets` links products to the existing `system_config.files`
registry. Each immutable version identifies a collection, variant, dimensions and
file. Files retain the storage key, SHA-256, MIME type, byte size and creator.
Originals and rendered versions remain separate. Binary files live in storage;
the PostgreSQL registry does not duplicate their contents.

Variants are `source`, `black`, `webp` and `thumbnail`. The existing product photo
API still accepts a JPEG of at most 256 KiB. A WebP file is a separate web asset,
not an interchangeable value for `photoDataUrl`.

Deploy the additive migration through the production migration workflow before
the API release. Apply `deploy/grant-product-media.sql` to the runtime role.
Imports must verify the tenant, SKU, content hashes and existing versions before
writing. A differing hash under an existing storage key requires a new version.
Business prices and fiscal classifications are independent of media imports.
