# frozen_string_literal: true

# Public accounts share the signing engine, never the installation's administration.
module AvilaPublicAccounts
  CONFIG_KEY = 'avila_public_account'

  def self.public?(account)
    AccountConfig.exists?(account_id: account.id, key: CONFIG_KEY, value: true)
  end

  module Permissions
    def initialize(user)
      super
      return unless AvilaPublicAccounts.public?(user.account)

      cannot :manage, EncryptedConfig
      cannot :manage, WebhookUrl
      cannot :manage, AccessToken
      cannot :create, User
      cannot :manage, AccountConfig, key: AvilaPublicAccounts::CONFIG_KEY
    end
  end

  module UserAccess
    def sidekiq?
      !AvilaPublicAccounts.public?(account) && super
    end
  end

  module ApiAccess
    private

    def current_user
      user = super
      user if user&.active_for_authentication?
    end
  end

  module EmailAvailability
    def can_send_emails?(account, **params)
      return false if AvilaPublicAccounts.public?(account)

      super
    end

    def can_send_invitation_emails?(account)
      !AvilaPublicAccounts.public?(account) && super
    end
  end

  module RecipientPreferences
    def avila_disable_public_email
      return unless AvilaPublicAccounts.public?(account)

      self.preferences = preferences.merge('send_email' => false, 'send_completed_email' => false)
    end
  end

  module MailDelivery
    def avila_check_document_delivery
      return unless @current_account && AvilaPublicAccounts.public?(@current_account)

      raise 'O envio de documentos por e-mail não está habilitado para esta conta.'
    end
  end
end
