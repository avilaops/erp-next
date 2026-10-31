# frozen_string_literal: true
require Rails.root.join('lib/avila_template_definition')

module Api
  class AvilaTemplatesController < ApiBaseController
    before_action :validate_identifier!
    rescue_from AvilaTemplateDefinition::Invalid do
      render json: { error: 'Confira o PDF, as páginas e as assinaturas obrigatórias de cada participante.' }, status: :unprocessable_entity
    end

    def show
      authorize! :create, Template
      template = published_template
      authorize! :read, template if template
      render json: template ? result(template) : { found: false }
    end

    def create
      authorize! :create, Template
      raise AvilaTemplateDefinition::Invalid if request.content_length.to_i > 8 * 1024 * 1024

      definition, pdf, digest = AvilaTemplateDefinition.parse(params[:definitionJson], params[:pdfBase64])
      template = nil
      conflict = false
      # Account row lock covers first publication as well as duplicate/retried requests.
      current_account.with_lock do
        template = published_template
        if template
          authorize! :read, template
          conflict = template.external_id != "#{prefix}#{digest}"
        else
          doc = Pdfium::Document.open_bytes(pdf)
          begin
            raise AvilaTemplateDefinition::Invalid if doc.encrypted? || doc.page_count != definition['pages']
          ensure
            doc.close
          end
          template = current_account.templates.new(author: current_user, name: definition['name'], source: 'api', shared_link: false)
          authorize! :create, template
          Templates.maybe_assign_access(template)
          template.save!
          file = ActionDispatch::Http::UploadedFile.new(tempfile: StringIO.new(pdf), filename: 'modelo.pdf', type: 'application/pdf')
          documents, = Templates::CreateAttachments.call(template, { files: [file] }, extract_fields: false)
          attachment = documents.fetch(0)
          submitters, fields = AvilaTemplateDefinition.build(definition, attachment.uuid)
          template.update!(external_id: "#{prefix}#{digest}", schema: [{ attachment_uuid: attachment.uuid, name: definition['name'] }], submitters: submitters, fields: fields)
        end
      end
      return render json: { error: 'A publicação já existe com outro conteúdo.' }, status: :conflict if conflict

      render json: result(template)
    rescue Pdfium::PasswordError
      raise AvilaTemplateDefinition::Invalid
    end

    private

    def validate_identifier!
      raise AvilaTemplateDefinition::Invalid unless AvilaTemplateDefinition::UUID.match?(params[:id].to_s)
    end

    def prefix
      "avila:#{params[:id]}:"
    end

    def published_template
      current_account.templates.where('external_id LIKE ?', "#{prefix}%").first
    end

    def result(template)
      { found: true, id: template.id, requestHash: template.external_id.delete_prefix(prefix), archived: template.archived_at.present? }
    end
  end
end
