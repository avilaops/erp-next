//! Explicit commercial associations after local inspection; no accounting effects.
#[path="cte_links_model.rs"] mod model;
#[path="cte_links_store.rs"] mod store;
pub use model::{CteCarrierChoice,CteCommercialLink,CteCommercialLinks,CteCommercialOptions,CteCommercialOrder,CteLinkInput,CteLinkKind,CteLinkOptionsQuery,CteUnlinkInput};
use crate::{domains::{DomainChange,DomainError,authorized,command_key,db,record,remember,replay,response,revision},platform::{access,auth::AuthenticatedIdentity,state::AppState}};
use axum::{Extension,Json,Router,extract::{Path,Query,State,rejection::{JsonRejection,QueryRejection}},http::{HeaderMap,StatusCode},response::Response,routing::{get,post}};
use serde_json::{Value,json};
use sqlx::{Postgres,Transaction};
use uuid::Uuid;

const READ:&str="fiscal.cte.read";
const LINK:&str="fiscal.cte.link";
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/fiscal/cte-distribution/documents/{id}/commercial-links",get(get_links).post(link))
        .route("/api/v1/fiscal/cte-distribution/documents/{id}/commercial-options",get(options))
        .route("/api/v1/fiscal/cte-distribution/documents/{id}/commercial-links/{linkId}/unlink",post(unlink))
}
async fn begin<'a>(state:&'a AppState,headers:&HeaderMap,identity:&AuthenticatedIdentity,id:Uuid,write:bool) -> Result<(Uuid,Transaction<'a,Postgres>,store::Rights,store::Source),DomainError> {
    let (tenant,mut tx,_)=authorized(state,headers,identity,READ,LINK,write).await?;
    if !write {
        // A revision and its rows must describe the same state, also on reads.
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR SHARE").bind(tenant).execute(&mut *tx).await.map_err(db)?;
    }
    let rights=store::rights(&mut tx,tenant,&identity.subject).await?;
    let source=store::source(&mut tx,tenant,id).await?;
    Ok((tenant,tx,rights,source))
}
fn require_target(rights:&store::Rights,kind:CteLinkKind,write:bool) -> Result<(),DomainError> {
    let target=match kind { CteLinkKind::Purchase=>rights.purchase,CteLinkKind::Sale=>rights.sale };
    if !rights.parties || !target || write && !rights.manage { return Err(access::AccessError::Forbidden.into()); }
    Ok(())
}

#[utoipa::path(get,path="/api/v1/fiscal/cte-distribution/documents/{id}/commercial-links",tag="Fiscal",operation_id="get_cte_commercial_links",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path)),responses((status=200,body=CteCommercialLinks),(status=403,description="Sem leitura CT-e"),(status=404,description="Arquivo ausente"),(status=409,description="Conferência ou empresa incompatível")))]
pub async fn get_links(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,Path(id):Path<Uuid>) -> Result<Response,DomainError> {
    let (tenant,mut tx,rights,source)=begin(&state,&headers,&identity,id,false).await?;
    let result=store::view(&mut tx,tenant,&source,&rights).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK,Some(result.revision),result))
}

#[utoipa::path(get,path="/api/v1/fiscal/cte-distribution/documents/{id}/commercial-options",tag="Fiscal",operation_id="get_cte_commercial_options",security(("bearerAuth"=[])),params(CteLinkOptionsQuery,("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path)),responses((status=200,body=CteCommercialOptions),(status=403,description="Sem leitura fiscal/pessoas/pedido"),(status=404,description="Arquivo ausente"),(status=409,description="Conferência ou empresa incompatível"),(status=422,description="Filtros inválidos")))]
pub async fn options(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,Path(id):Path<Uuid>,query:Result<Query<CteLinkOptionsQuery>,QueryRejection>) -> Result<Response,DomainError> {
    let (tenant,mut tx,rights,source)=begin(&state,&headers,&identity,id,false).await?;
    let Query(query)=query.map_err(|_|DomainError::Invalid("Filtros comerciais CT-e inválidos"))?;
    require_target(&rights,query.kind,false)?;
    let result=store::options(&mut tx,tenant,&source,query).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK,None,result))
}

async fn finish(tx:&mut Transaction<'_,Postgres>,tenant:Uuid,identity:&AuthenticatedIdentity,source:&store::Source,rights:&store::Rights,command:(Uuid,&str,&Value)) -> Result<(i64,Value),DomainError> {
    let (key,scope,request)=command;
    let result=store::view(tx,tenant,source,rights).await?;
    let revision=result.revision;
    let value=serde_json::to_value(result).map_err(|_|access::AccessError::Internal)?;
    remember(tx,tenant,&identity.subject,key,scope,request,&value).await?;
    Ok((revision,value))
}

#[utoipa::path(post,path="/api/v1/fiscal/cte-distribution/documents/{id}/commercial-links",tag="Fiscal",operation_id="create_cte_commercial_link",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),request_body=CteLinkInput,responses((status=201,body=CteCommercialLinks),(status=200,body=CteCommercialLinks),(status=403,description="Sem permissões de vínculo"),(status=404,description="Arquivo ou pedido ausente"),(status=409,description="Associação ou frete incompatível"),(status=412,description="Revisão desatualizada"),(status=422,description="Campos inválidos"),(status=428,description="Revisão/chave obrigatórias")))]
pub async fn link(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,Path(id):Path<Uuid>,payload:Result<Json<CteLinkInput>,JsonRejection>) -> Result<Response,DomainError> {
    let (tenant,mut tx,rights,source)=begin(&state,&headers,&identity,id,true).await?;
    let Json(mut input)=payload.map_err(|_|DomainError::Invalid("Informe pedido, transportadora, frete e motivo da conferência"))?;
    require_target(&rights,input.kind,true)?;
    let expected=revision(&headers)?; let key=command_key(&headers)?;
    let cents=model::freight(&input.freight_cents)?; input.reason=model::reason(&input.reason)?;
    let request=json!({"documentId":id,"inspectionId":source.inspection,"xmlSha256":source.hash,"revision":expected,"input":input});
    if replay(&mut tx,tenant,&identity.subject,key,LINK,&request).await?.is_some() {
        let result=store::view(&mut tx,tenant,&source,&rights).await?;
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK,Some(result.revision),result));
    }
    if store::revision(&mut tx,tenant,id).await?!=expected { return Err(DomainError::StaleRevision); }
    let carrier=store::carrier(&mut tx,tenant,&source,&rights).await?;
    if !carrier.available || carrier.party_id!=input.carrier_party_id { return Err(DomainError::Conflict("Selecione a transportadora ativa com o mesmo CNPJ do XML, ou a própria empresa quando emitente")); }
    let target=store::target(&mut tx,tenant,input.kind,input.order_id).await?;
    let active=store::active(&mut tx,tenant,id).await?;
    if active.len()>=50 { return Err(DomainError::Conflict("Limite de 50 vínculos ativos neste CT-e")); }
    if active.iter().any(|row|match input.kind { CteLinkKind::Purchase=>row.purchase_order_id==Some(input.order_id),CteLinkKind::Sale=>row.sales_order_id==Some(input.order_id) }) { return Err(DomainError::Conflict("Este pedido já possui vínculo ativo com o CT-e")); }
    let allocated=active.iter().try_fold(0_i64,|sum,row|sum.checked_add(row.freight_cents)).ok_or(access::AccessError::Internal)?;
    if allocated.checked_add(cents).is_none_or(|total|total>source.facts.service_cents) { return Err(DomainError::Conflict("O frete associado ultrapassa o valor da prestação CT-e")); }
    let link=Uuid::now_v7();
    let (purchase,sale)=match input.kind { CteLinkKind::Purchase=>(Some(input.order_id),None),CteLinkKind::Sale=>(None,Some(input.order_id)) };
    sqlx::query("INSERT INTO fiscal_cte_commercial_links(tenant_id,id,document_id,inspection_id,source_xml_sha256,carrier_party_id,carrier_tax_id,carrier_name,purchase_order_id,sales_order_id,counterparty_name,order_amount_cents,order_revision,freight_cents,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
        .bind(tenant).bind(link).bind(id).bind(source.inspection).bind(&source.hash).bind(carrier.party_id).bind(&carrier.tax_id).bind(&carrier.name).bind(purchase).bind(sale).bind(&target.counterparty_name).bind(target.amount_cents).bind(target.revision).bind(cents).bind(&input.reason).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"fiscal_cte_commercial_link",id:link,event:"fiscal.cte.linked",details:json!({"documentId":id,"inspectionId":source.inspection,"xmlSha256":source.hash,"kind":input.kind,"orderId":input.order_id,"carrierPartyId":carrier.party_id,"freightCents":input.freight_cents,"reason":input.reason})}).await?;
    let (revision,result)=finish(&mut tx,tenant,&identity,&source,&rights,(key,LINK,&request)).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED,Some(revision),result))
}

#[utoipa::path(post,path="/api/v1/fiscal/cte-distribution/documents/{id}/commercial-links/{linkId}/unlink",tag="Fiscal",operation_id="unlink_cte_commercial_link",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path),("linkId"=Uuid,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),request_body=CteUnlinkInput,responses((status=200,body=CteCommercialLinks),(status=403,description="Sem permissões de vínculo"),(status=404,description="Arquivo ou vínculo ausente"),(status=409,description="Empresa incompatível ou vínculo desfeito"),(status=412,description="Revisão desatualizada"),(status=422,description="Motivo inválido"),(status=428,description="Revisão/chave obrigatórias")))]
pub async fn unlink(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,Path((id,link_id)):Path<(Uuid,Uuid)>,payload:Result<Json<CteUnlinkInput>,JsonRejection>) -> Result<Response,DomainError> {
    let (tenant,mut tx,rights,source)=begin(&state,&headers,&identity,id,true).await?;
    let Json(mut input)=payload.map_err(|_|DomainError::Invalid("Informe o motivo para desfazer o vínculo"))?;
    input.reason=model::reason(&input.reason)?;
    let expected=revision(&headers)?; let key=command_key(&headers)?;
    let kind:Option<bool>=sqlx::query_scalar("SELECT purchase_order_id IS NOT NULL FROM fiscal_cte_commercial_links WHERE tenant_id=$1 AND document_id=$2 AND id=$3")
        .bind(tenant).bind(id).bind(link_id).fetch_optional(&mut *tx).await.map_err(db)?;
    require_target(&rights,if kind.ok_or(DomainError::NotFound)? {CteLinkKind::Purchase}else{CteLinkKind::Sale},true)?;
    let scope="fiscal.cte.unlink";
    let request=json!({"documentId":id,"linkId":link_id,"inspectionId":source.inspection,"xmlSha256":source.hash,"revision":expected,"input":input});
    if replay(&mut tx,tenant,&identity.subject,key,scope,&request).await?.is_some() {
        let result=store::view(&mut tx,tenant,&source,&rights).await?;
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK,Some(result.revision),result));
    }
    if store::revision(&mut tx,tenant,id).await?!=expected { return Err(DomainError::StaleRevision); }
    let already:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_cte_commercial_unlinks WHERE tenant_id=$1 AND link_id=$2)").bind(tenant).bind(link_id).fetch_one(&mut *tx).await.map_err(db)?;
    if already { return Err(DomainError::Conflict("Este vínculo já foi desfeito; o histórico foi preservado")); }
    let removal=Uuid::now_v7();
    sqlx::query("INSERT INTO fiscal_cte_commercial_unlinks(tenant_id,id,document_id,link_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant).bind(removal).bind(id).bind(link_id).bind(&input.reason).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"fiscal_cte_commercial_link",id:link_id,event:"fiscal.cte.unlinked",details:json!({"documentId":id,"unlinkId":removal,"linkId":link_id,"xmlSha256":source.hash,"reason":input.reason})}).await?;
    let (revision,result)=finish(&mut tx,tenant,&identity,&source,&rights,(key,scope,&request)).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK,Some(revision),result))
}
