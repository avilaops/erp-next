# frozen_string_literal: true
Rails.application.config.filter_parameters += %i[pdfBase64 definitionJson]
Rails.application.routes.append do
  get '/api/avila/templates/:id', to: 'api/avila_templates#show'
  post '/api/avila/templates/:id', to: 'api/avila_templates#create'
end

Rails.application.config.to_prepare do
  Template.before_update :protect_avila_published_version
  Template.class_eval do
    def protect_avila_published_version
      return unless external_id_in_database.to_s.start_with?('avila:')
      return if (changes_to_save.keys & %w[external_id name fields submitters schema]).empty?

      errors.add(:base, 'Esta versão publicada é imutável. Edite o rascunho no ERP e publique uma nova versão.')
      throw :abort
    end
  end
end
