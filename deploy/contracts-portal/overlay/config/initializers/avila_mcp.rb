# frozen_string_literal: true

Rails.application.config.to_prepare do
  Mcp::McpBaseController.prepend(AvilaMcp::Authentication)
  Mcp::ProtocolController.prepend(AvilaMcp::Protocol)
  Mcp::CreateTemplateController.prepend(AvilaMcp::TemplateCreation)
  Mcp::SendDocumentsController.prepend(AvilaMcp::DocumentSending)

  McpToken.validates :name, presence: true, length: { maximum: 100 }
end
