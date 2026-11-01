# frozen_string_literal: true

raise 'Disposable CI database required' unless ENV['AVILA_PUBLICATION_TEST'] == 'true'

require 'rack/test'
require 'nokogiri'

def check(condition, message)
  raise message unless condition
end

def browser
  Rack::Test::Session.new(Rack::MockSession.new(Rails.application))
end

def visit(client, path)
  client.get("https://contrato.avilaops.com#{path}")
  client.last_response
end

def csrf(client)
  Nokogiri::HTML(client.last_response.body).at_css('meta[name="csrf-token"]')&.[]('content') ||
    Nokogiri::HTML(client.last_response.body).at_css('input[name="authenticity_token"]')&.[]('value')
end

def signup(client, email, extra = {})
  visit(client, '/sign_up')
  check(client.last_response.status == 200, 'signup page missing')
  check(csrf(client).present?, 'signup CSRF token missing')
  password = SecureRandom.hex(16)
  payload = { account_name: 'CI public account', authenticity_token: csrf(client),
              user: { first_name: 'CI', email:, password:, password_confirmation: password } }
  payload.deep_merge!(extra)
  client.post('https://contrato.avilaops.com/sign_up', payload)
  client.last_response
end

def rpc(client, token, method, params = {}, headers = {})
  client.post('https://contrato.avilaops.com/mcp', JSON.generate(jsonrpc: '2.0', id: 1, method:, params:),
              { 'CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json, text/event-stream',
                'HTTP_AUTHORIZATION' => "Bearer #{token}" }.merge(headers))
  client.last_response
end

def tool(client, token, name, arguments)
  response = rpc(client, token, 'tools/call', { name:, arguments: })
  check(response.status == 200, "tool #{name} failed with HTTP #{response.status}")
  JSON.parse(response.body).fetch('result')
end

def data(result)
  JSON.parse(result.fetch('content').first.fetch('text'))
end

RateLimit::STORE.clear
alice_browser = browser
bob_browser = browser
anonymous = browser
visit(anonymous, '/sign_in')
check(anonymous.last_response.body.include?('Criar conta'), 'login missing signup link')
visit(anonymous, '/integracoes/mcp')
check(anonymous.last_response.status == 200, 'public MCP guide missing')
visit(anonymous, '/')
check(anonymous.last_response.body.include?('Criar conta'), 'landing missing signup link')

before_accounts = Account.count
response = signup(anonymous, 'bad-public@example.test', user: { password: 'short', password_confirmation: 'different' })
check(response.status == 422 && Account.count == before_accounts, 'invalid password created account')
response = signup(alice_browser, 'alice-public@example.test', user: { account_id: Account.first.id, role: 'owner' })
check(response.status == 302, "signup failed: HTTP #{response.status}")
alice = User.find_by!(email: 'alice-public@example.test')
check(alice.account_id != Account.first.id && alice.role == 'admin', 'signup accepted injected account/role')
check(alice.confirmed_at.nil?, 'signup falsely confirmed email ownership')
check(AvilaPublicAccounts.public?(alice.account), 'public account marker absent')
check(alice.account.encrypted_configs.exists?(key: EncryptedConfig::ESIGN_CERTS_KEY), 'account signing certificate missing')
check(alice.account.templates.empty? && alice.account.submissions.empty?, 'signup copied private records')
visit(alice_browser, '/settings/mcp')
check(alice_browser.last_response.status == 200 && alice_browser.last_response.body.include?('Gerar token'), 'signup session or MCP page failed')

response = signup(bob_browser, 'bob-public@example.test')
check(response.status == 302, 'second signup failed')
bob = User.find_by!(email: 'bob-public@example.test')
check(alice.account_id != bob.account_id, 'public accounts not isolated')
before_accounts = Account.count
response = signup(anonymous, alice.email)
check(response.status == 422 && Account.count == before_accounts, 'duplicate email created orphan account')

visit(anonymous, '/sign_up')
anonymous.post('https://contrato.avilaops.com/sign_up', account_name: 'CSRF', user: { email: 'csrf@example.test' })
check(anonymous.last_response.status == 422 && !User.exists?(email: 'csrf@example.test'), 'registration accepted missing CSRF')

visit(alice_browser, '/settings/mcp/new')
token_csrf = csrf(alice_browser)
check(token_csrf.present?, 'new MCP token form failed')
alice_browser.post('https://contrato.avilaops.com/settings/mcp', authenticity_token: token_csrf, mcp_token: { name: 'CI client' })
check(alice_browser.last_response.status == 201, 'MCP token creation failed')
alice_token = Nokogiri::HTML(alice_browser.last_response.body).at_css('#mcp_token')&.[]('value')
check(alice_token.present?, 'MCP token not shown on creation')
token_record = alice.mcp_tokens.last
check(token_record.sha256 == Digest::SHA256.hexdigest(alice_token), 'token hash missing')
visit(alice_browser, '/settings/mcp')
check(!alice_browser.last_response.body.include?(alice_token), 'token shown again after initial creation')
bob_token = bob.mcp_tokens.create!(name: 'CI other client').token

check(rpc(anonymous, '', 'initialize').status == 401, 'anonymous MCP accepted')
check(rpc(anonymous, 'invalid', 'tools/list').status == 401, 'invalid MCP token accepted')
check(rpc(anonymous, alice_token, 'initialize', {}, 'HTTP_ORIGIN' => 'https://evil.example').status == 403, 'foreign Origin accepted')
response = rpc(anonymous, alice_token, 'initialize', protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ci', version: '1' })
check(JSON.parse(response.body).dig('result', 'serverInfo', 'name') == 'avila-contratos', 'MCP initialize failed')
tools = JSON.parse(rpc(anonymous, alice_token, 'tools/list').body).dig('result', 'tools')
check(tools.map { |entry| entry['name'] }.sort == %w[create_template load_template search_documents search_templates], 'public tool catalog mismatch')
check(!tools.find { |entry| entry['name'] == 'create_template' }.dig('inputSchema', 'properties').key?('url'), 'public tool advertises remote download')
created = data(tool(anonymous, alice_token, 'create_template', name: 'CI Alice private'))
template_id = created.fetch('id')
check(Template.find(template_id).account_id == alice.account_id, 'MCP created template in wrong account')
check(data(tool(anonymous, alice_token, 'search_templates', q: 'CI Alice')).any? { |t| t['id'] == template_id }, 'owner cannot search template')
check(data(tool(anonymous, bob_token, 'search_templates', q: 'CI Alice')).empty?, 'other tenant found private template')
check(tool(anonymous, bob_token, 'load_template', template_id:)['isError'], 'other tenant loaded template by guessed ID')
check(data(tool(anonymous, alice_token, 'load_template', template_id:))['id'] == template_id, 'owner cannot load template')
check(tool(anonymous, alice_token, 'create_template', name: 'Blocked URL', url: 'https://127.0.0.1/private')['isError'], 'public MCP accepted remote download')
check(tool(anonymous, alice_token, 'send_documents', template_id:, submitters: [{ email: 'nobody@example.test' }])['isError'], 'public MCP sent document')
check(Submission.count.zero?, 'MCP rejection created signing request')

submission = alice.account.submissions.create!(template: Template.find(template_id), created_by_user: alice,
                                             template_fields: [], template_submitters: [])
recipient = submission.submitters.create!(account: alice.account, uuid: SecureRandom.uuid, email: 'ci-signer@example.test',
                                         preferences: { 'send_email' => true, 'send_completed_email' => true })
check(recipient.preferences['send_email'] == false && recipient.preferences['send_completed_email'] == false, 'public recipient enabled email')
check(data(tool(anonymous, bob_token, 'search_documents', q: '')).none? { |s| s['id'] == submission.id }, 'other tenant found submission')
check(data(tool(anonymous, alice_token, 'search_documents', q: '')).any? { |s| s['id'] == submission.id }, 'owner cannot list submission')

ability = Ability.new(alice)
check(!ability.can?(:manage, EncryptedConfig.new(account: alice.account, key: EncryptedConfig::FILES_STORAGE_KEY)), 'public account may change global storage')
check(!ability.can?(:manage, EncryptedConfig.new(account: alice.account, key: EncryptedConfig::APP_URL_KEY)), 'public account may change global URL')
check(!ability.can?(:manage, alice.account.account_configs.find_by!(key: AvilaPublicAccounts::CONFIG_KEY)), 'public marker mutable')
check(!alice.sidekiq?, 'public user may administer background jobs')
check(!Accounts.can_send_emails?(alice.account), 'public UI advertises email sending')
visit(alice_browser, '/settings/storage')
check(alice_browser.last_response.status == 302, 'public storage screen exposed')
visit(alice_browser, '/settings/email')
check(alice_browser.last_response.status == 302, 'public SMTP screen exposed')

%w[null [] 42].each do |body|
  anonymous.post('https://contrato.avilaops.com/mcp', body, 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{alice_token}")
  check(anonymous.last_response.status == 400, 'invalid JSON-RPC shape not rejected')
end
check(rpc(anonymous, alice_token, 'tools/call', name: 'search_templates', arguments: { q: [], limit: 1000 }).status == 400, 'invalid tool arguments accepted')
anonymous.get('https://contrato.avilaops.com/mcp', {}, 'HTTP_AUTHORIZATION' => "Bearer #{alice_token}")
check(anonymous.last_response.status == 405, 'unsupported SSE GET must be 405')

config = alice.account.account_configs.find_by!(key: AccountConfig::ENABLE_MCP_KEY)
config.update!(value: false)
check(rpc(anonymous, alice_token, 'tools/list').status == 403, 'account disable did not stop MCP')
config.update!(value: true)
alice.account.update!(archived_at: Time.current)
check(rpc(anonymous, alice_token, 'tools/list').status == 401, 'archived account accepted')
alice.account.update!(archived_at: nil)
alice.update!(locked_at: Time.current)
check(rpc(anonymous, alice_token, 'tools/list').status == 401, 'locked user accepted')
alice.update!(locked_at: nil, archived_at: Time.current)
check(rpc(anonymous, alice_token, 'tools/list').status == 401, 'archived user accepted')
alice.update!(archived_at: nil)
visit(alice_browser, '/settings/mcp')
alice_browser.delete("https://contrato.avilaops.com/settings/mcp/#{token_record.id}", authenticity_token: csrf(alice_browser))
check(alice_browser.last_response.status == 302, 'MCP revoke UI failed')
check(rpc(anonymous, alice_token, 'tools/list').status == 401, 'revoked token accepted')

RateLimit::STORE.clear
5.times { signup(anonymous, 'invalid-limit@example.test', user: { password: 'short' }) }
check(signup(anonymous, 'limit@example.test').status == 429, 'signup rate limit missing')
puts 'Public access: signup, CSRF, account isolation, MCP protocol, token lifecycle, global settings and rate limits passed.'
