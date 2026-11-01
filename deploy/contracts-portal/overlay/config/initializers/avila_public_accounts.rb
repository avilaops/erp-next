# frozen_string_literal: true

Rails.application.routes.append do
  get '/sign_up', to: 'avila_registrations#new', as: :avila_sign_up
  post '/sign_up', to: 'avila_registrations#create'
  get '/criar-conta', to: redirect('/sign_up')
  get '/integracoes/mcp', to: 'avila_integrations#show', as: :avila_mcp_guide
end

Rails.application.config.to_prepare do
  Ability.prepend(AvilaPublicAccounts::Permissions)
  User.prepend(AvilaPublicAccounts::UserAccess)
  Api::ApiBaseController.prepend(AvilaPublicAccounts::ApiAccess)
  Accounts.singleton_class.prepend(AvilaPublicAccounts::EmailAvailability)
  Submitter.include(AvilaPublicAccounts::RecipientPreferences)
  Submitter.before_validation :avila_disable_public_email
  [SubmitterMailer, TemplateMailer].each do |mailer|
    mailer.include(AvilaPublicAccounts::MailDelivery)
    mailer.after_action :avila_check_document_delivery
  end
end
