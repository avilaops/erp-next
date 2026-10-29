# Administrative setup through Rails on our pinned portal installation.
# Uses the same native attachment service as the upload UI; never sends email.
require 'digest'
require 'json'

Rails.logger.level = Logger::FATAL
ActiveRecord::Base.logger = nil
directory, administrator = ARGV
raise 'Usage: rails runner install-validation-template.rb ARTIFACT_DIRECTORY ADMIN_EMAIL' unless directory && administrator
manifest = JSON.parse(File.read(File.join(directory, 'validation.json')))
pdf_path = File.join(directory, 'validation.pdf')
raise 'Unexpected model' unless manifest['external_id'] == 'avilaops-erp-validation-v1'
raise 'PDF checksum mismatch' unless Digest::SHA256.file(pdf_path).hexdigest == manifest.fetch('sha256')
user = User.active.admins.find_by!(email: administrator)
raise 'Account archived' if user.account.archived_at?

user.account.with_lock do
  existing = user.account.templates.where(external_id: manifest.fetch('external_id')).to_a
  raise 'Duplicate validation models require inspection' if existing.size > 1
  if existing.any?
    template = existing.first
    raise 'Existing model incomplete or archived; inspect instead of overwriting' if template.archived_at? || template.schema.blank? || template.fields.blank?
    puts JSON.generate(id: template.id, name: template.name, reused: true)
    next
  end
  template = Template.new(account: user.account, author: user, name: manifest.fetch('name'), external_id: manifest.fetch('external_id'), submitters: manifest.fetch('submitters'), shared_link: false)
  template.folder = TemplateFolders.find_or_create_by_name(user, 'Validação técnica ERP')
  Templates.maybe_assign_access(template)
  template.save!
  file = ActionDispatch::Http::UploadedFile.new(tempfile: File.open(pdf_path, 'rb'), filename: 'validacao-tecnica-avilaops.pdf', type: 'application/pdf')
  begin
    documents, = Templates::CreateAttachments.call(template, { files: [file] }, extract_fields: false)
    raise 'Expected exactly one document' unless documents.one?
    document = documents.first
    fields = manifest.fetch('fields').map { |field| field.merge('areas' => field.fetch('areas').map { |area| area.merge('attachment_uuid' => document.uuid) }) }
    template.update!(schema: [{ attachment_uuid: document.uuid, name: 'Validação técnica — sem valor comercial' }], fields: fields)
    SearchEntries.enqueue_reindex(template)
    puts JSON.generate(id: template.id, name: template.name, fields: template.fields.size, reused: false)
  ensure
    file.close
  end
end
