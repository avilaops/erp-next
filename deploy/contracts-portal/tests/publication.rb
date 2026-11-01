# frozen_string_literal: true
# Run only inside the disposable GitHub CI database, never on a production host.
raise 'CI database required' unless ENV['AVILA_PUBLICATION_TEST'] == 'true'
require 'rack/mock'
require 'hexapdf'

def check(condition, message)
  raise message unless condition
end

account = Account.create!(name: 'CI publication fixture')
user = account.users.create!(email: 'publication@example.test', password: SecureRandom.hex(24), role: 'admin', confirmed_at: Time.current)
token = user.create_access_token!.token
document = HexaPDF::Document.new
document.pages.add
io = StringIO.new
document.write(io)
definition = { name: 'Technical CI model', pages: 1, roles: ['Cliente'], fields: [
  { id: SecureRandom.uuid, name: 'Assinatura', role: 'Cliente', kind: 'signature', required: true,
    page: 1, x: 10, y: 10, width: 40, height: 10,
    additionalAreas: [{ page: 1, x: 10, y: 30, width: 40, height: 10 }] }
] }
body = { definitionJson: JSON.generate(definition), pdfBase64: Base64.strict_encode64(io.string) }
path = "/api/avila/templates/#{SecureRandom.uuid}"
client = Rack::MockRequest.new(Rails.application)
headers = { 'HTTP_X_AUTH_TOKEN' => token, 'CONTENT_TYPE' => 'application/json', 'HTTPS' => 'on' }
check(client.get(path, 'HTTPS' => 'on').status == 401, 'anonymous access must be rejected')
check(JSON.parse(client.get(path, headers).body)['found'] == false, 'new publication must be absent')
first = client.post(path, headers.merge(input: JSON.generate(body)))
check(first.status == 200, "publication failed with status #{first.status}: #{first.body}")
result = JSON.parse(first.body)
check(result['found'] && result['id'].positive?, 'provider confirmation missing')
check(client.post(path, headers.merge(input: JSON.generate(body))).body == first.body, 'retry must return same publication')
check(account.templates.count == 1, 'retry created duplicate template')
check(account.templates.first.fields.first['areas'].size == 2, 'repeated signature position was dropped')
check(account.templates.first.documents.count == 1, 'PDF missing')
check(!account.templates.first.update(name: 'Mutation'), 'published model must remain immutable')
changed = body.merge(definitionJson: JSON.generate(definition.merge(name: 'Changed content')))
check(client.post(path, headers.merge(input: JSON.generate(changed))).status == 409, 'same publication with changed content must conflict')
invalid = body.merge(definitionJson: JSON.generate(definition.merge(pages: 2)))
check(client.post("/api/avila/templates/#{SecureRandom.uuid}", headers.merge(input: JSON.generate(invalid))).status == 422, 'real PDF page count must be verified')
other = Account.create!(name: 'Other tenant fixture').users.create!(email: 'other@example.test', password: SecureRandom.hex(24), role: 'admin', confirmed_at: Time.current)
other_headers = headers.merge('HTTP_X_AUTH_TOKEN' => other.create_access_token!.token)
check(JSON.parse(client.get(path, other_headers).body)['found'] == false, 'another account saw the publication')
check(Submission.count.zero?, 'publishing must never create a signing request')
puts 'Publication integration: authorization, PDF validation, multiple positions, immutable retry and account isolation passed.'
