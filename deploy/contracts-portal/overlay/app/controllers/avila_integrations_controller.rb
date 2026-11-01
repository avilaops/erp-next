# frozen_string_literal: true

class AvilaIntegrationsController < ApplicationController
  around_action ->(_controller, action) { I18n.with_locale(:pt, &action) }
  skip_before_action :authenticate_user!
  skip_authorization_check

  def show; end
end
