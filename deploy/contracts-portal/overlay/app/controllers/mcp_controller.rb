# frozen_string_literal: true

class McpController < ActionController::Metal
  MAX_BODY_SIZE = 256 * 1024
  TOOL_CONTROLLERS = {
    'search_templates' => Mcp::SearchTemplatesController,
    'load_template' => Mcp::LoadTemplateController,
    'create_template' => Mcp::CreateTemplateController,
    'send_documents' => Mcp::SendDocumentsController,
    'search_documents' => Mcp::SearchDocumentsController
  }.freeze
  TOOLS = TOOL_CONTROLLERS.values.map { |controller| controller::SCHEMA }.freeze

  def call
    request.request_parameters = {}
    return dispatch_protocol(:ok) if request.get?
    return dispatch_protocol(:payload_too_large) if request.content_length.to_i > MAX_BODY_SIZE

    raw = request.body.read(MAX_BODY_SIZE + 1)
    return dispatch_protocol(:payload_too_large) if raw.bytesize > MAX_BODY_SIZE

    body = JSON.parse(raw)
    return dispatch_protocol(:invalid_request) unless body.is_a?(Hash) && body['jsonrpc'] == '2.0' && body['method'].is_a?(String)
    return dispatch_protocol(:invalid_request) if body.key?('id') && !body['id'].is_a?(String) && !body['id'].is_a?(Integer)

    request.request_parameters = body
    return dispatch_protocol(:invalid_params) if body.key?('params') && !body['params'].is_a?(Hash)
    return dispatch_protocol(:invalid_request) unless body.key?('id') || body['method'].start_with?('notifications/')

    action = case body['method']
             when 'initialize' then :initialize_request
             when 'notifications/initialized' then :initialized_notification
             when 'ping' then :ping
             when 'tools/list' then :tools_list
             when 'tools/call'
               return dispatch_protocol(:invalid_params) unless valid_tool_arguments?(body['params'])

               tool = TOOL_CONTROLLERS[body.dig('params', 'name')]
               return tool.dispatch(:call, request, response) if tool

               :tool_not_found
             else :method_not_found
             end
    dispatch_protocol(action)
  rescue JSON::ParserError
    request.request_parameters = {}
    dispatch_protocol(:parse_error)
  end

  private

  def dispatch_protocol(action)
    Mcp::ProtocolController.dispatch(action, request, response)
  end

  def valid_tool_arguments?(params)
    return false unless params.is_a?(Hash) && params['name'].is_a?(String)

    args = params.fetch('arguments', {})
    return false unless args.is_a?(Hash)

    case params['name']
    when 'search_templates', 'search_documents'
      args['q'].is_a?(String) && args['q'].length <= 500 &&
        (!args.key?('limit') || (args['limit'].is_a?(Integer) && args['limit'].between?(1, 100)))
    when 'load_template'
      args['template_id'].is_a?(Integer) && args['template_id'].positive?
    when 'create_template'
      args['name'].is_a?(String) && args['name'].strip.length.between?(1, 200) &&
        (!args.key?('url') || (args['url'].is_a?(String) && args['url'].length <= 2048))
    when 'send_documents'
      args['template_id'].is_a?(Integer) && args['template_id'].positive? &&
        args['submitters'].is_a?(Array) && args['submitters'].size.between?(1, 50) &&
        args['submitters'].all? do |submitter|
          submitter.is_a?(Hash) && %w[email name phone role].all? { |key| !submitter.key?(key) || submitter[key].is_a?(String) } &&
            (!submitter.key?('fields') || (submitter['fields'].is_a?(Array) && submitter['fields'].all? do |field|
              field.is_a?(Hash) && field['name'].is_a?(String) && field.key?('value')
            end))
        end
    else true
    end
  end
end
