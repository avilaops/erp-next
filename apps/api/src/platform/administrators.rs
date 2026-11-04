use sqlx::{Postgres, Transaction};

use super::access::{AccessError, database_error};

pub(crate) async fn authorized(
    transaction: &mut Transaction<'_, Postgres>,
    subject: &str,
) -> Result<bool, AccessError> {
    sqlx::query("SELECT set_config('app.auth_subject', $1, true)")
        .bind(subject)
        .execute(&mut **transaction)
        .await
        .map_err(database_error)?;
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM platform_administrators WHERE auth_subject = $1 AND active)",
    )
    .bind(subject)
    .fetch_one(&mut **transaction)
    .await
    .map_err(database_error)
}
