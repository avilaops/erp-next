# frozen_string_literal: true

class AvilaRegistrationsController < ApplicationController
  skip_before_action :authenticate_user!
  skip_authorization_check
  before_action :redirect_signed_in_user
  before_action :limit_registration_attempts, only: :create

  def new
    @user = User.new
  end

  def create
    attrs = params.require(:user).permit(:first_name, :email, :password, :password_confirmation)
    @user = User.new(attrs)
    account_name = params[:account_name].to_s.strip
    account = Account.new(name: account_name, locale: 'pt', timezone: 'America/Sao_Paulo')
    @user.account = account

    @user.valid?
    @user.errors.add(:base, 'Informe o nome da sua empresa ou conta (até 120 caracteres).') unless account_name.length.between?(1, 120)
    @user.errors.add(:first_name, 'deve ter entre 1 e 100 caracteres') unless @user.first_name.to_s.strip.length.between?(1, 100)
    @user.errors.add(:password, 'deve ter entre 12 e 128 caracteres') unless attrs[:password].to_s.length.between?(12, 128)
    @user.errors.add(:password_confirmation, 'não confere') unless attrs[:password].present? && attrs[:password] == attrs[:password_confirmation]
    @user.errors.add(:email, 'é muito longo') if @user.email.to_s.length > 254
    return render :new, status: :unprocessable_entity if @user.errors.any?

    Account.transaction do
      account.save!
      @user.save!
      account.account_configs.create!(key: AvilaPublicAccounts::CONFIG_KEY, value: true)
      account.account_configs.create!(key: AccountConfig::ENABLE_MCP_KEY, value: true)
      account.encrypted_configs.create!(key: EncryptedConfig::ESIGN_CERTS_KEY,
                                        value: GenerateCertificate.call.transform_values(&:to_pem))
    end

    sign_in(:user, @user)
    redirect_to settings_mcp_index_path, notice: 'Conta criada. Seus documentos ficam separados dos de outras contas.'
  rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
    @user.errors.add(:base, 'Não foi possível criar a conta com esses dados. Confira o e-mail ou entre na sua conta.')
    render :new, status: :unprocessable_entity
  end

  private

  def redirect_signed_in_user
    redirect_to root_path if signed_in?
  end

  def limit_registration_attempts
    RateLimit.call("avila:signup:#{request.remote_ip}", limit: 5, ttl: 1.hour, enabled: true)
    RateLimit.call('avila:signup:global', limit: 100, ttl: 1.hour, enabled: true)
  rescue RateLimit::LimitApproached
    response.set_header('Retry-After', '3600')
    render plain: 'Muitas tentativas de cadastro. Tente novamente em uma hora.', status: :too_many_requests
  end
end
