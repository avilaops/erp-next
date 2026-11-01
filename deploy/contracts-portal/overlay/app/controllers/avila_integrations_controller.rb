# frozen_string_literal: true

class AvilaIntegrationsController < ApplicationController
  skip_before_action :authenticate_user!
  skip_authorization_check

  def show; end
end
