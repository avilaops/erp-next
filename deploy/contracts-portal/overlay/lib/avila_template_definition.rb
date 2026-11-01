# frozen_string_literal: true

require 'json'
require 'base64'
require 'digest'
require 'securerandom'

# Our editable format is independent of the licensed embedded builder.
module AvilaTemplateDefinition
  Invalid = Class.new(StandardError)
  UUID = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i
  module_function

  def parse(raw, encoded_pdf)
    raise Invalid unless raw.is_a?(String) && raw.bytesize <= 512_000
    raise Invalid unless encoded_pdf.is_a?(String) && encoded_pdf.bytesize <= 7_000_000

    pdf = Base64.strict_decode64(encoded_pdf)
    raise Invalid unless pdf.start_with?('%PDF-') && pdf.bytesize <= 5 * 1024 * 1024

    definition = JSON.parse(raw)
    validate(definition)
    [definition, pdf, Digest::SHA256.hexdigest("#{Digest::SHA256.hexdigest(pdf)}:#{raw}")]
  rescue JSON::ParserError, ArgumentError, TypeError, NoMethodError
    raise Invalid
  end

  def text?(value)
    value.is_a?(String) && !value.strip.empty? && value.bytesize <= 200 && !value.match?(/[[:cntrl:]]/)
  end

  def validate(definition)
    raise Invalid unless definition.is_a?(Hash) && text?(definition['name'])
    raise Invalid unless definition['pages'].is_a?(Integer) && (1..100).cover?(definition['pages'])

    roles = definition['roles']
    fields = definition['fields']
    raise Invalid unless roles.is_a?(Array) && (1..10).cover?(roles.size) && roles.all? { |r| text?(r) } && roles.uniq == roles
    raise Invalid unless fields.is_a?(Array) && (1..100).cover?(fields.size)
    raise Invalid unless fields.map { |f| f['id'] }.uniq.size == fields.size && fields.map { |f| f['name'] }.uniq.size == fields.size

    fields.each do |field|
      raise Invalid unless UUID.match?(field['id'].to_s) && text?(field['name']) && roles.include?(field['role'])
      raise Invalid unless %w[text signature initials date number].include?(field['kind'])
      raise Invalid unless [true, false].include?(field['required'])
      font = field['fontSize']
      raise Invalid unless font.nil? || (font.is_a?(Numeric) && font.finite? && (6..72).cover?(font))
      extra = field.fetch('additionalAreas', [])
      raise Invalid unless extra.is_a?(Array) && extra.size <= 99
      [field, *extra].each do |area|
        raise Invalid unless area['page'].is_a?(Integer) && (1..definition['pages']).cover?(area['page'])
        raise Invalid unless %w[x y width height].all? { |k| area[k].is_a?(Numeric) && area[k].finite? && (0..100).cover?(area[k]) }
        raise Invalid unless area['width'].positive? && area['height'].positive? && area['x'] + area['width'] <= 100 && area['y'] + area['height'] <= 100
      end
    end
    raise Invalid unless roles.all? { |role| fields.any? { |f| f['role'] == role && f['kind'] == 'signature' && f['required'] } }
  end

  def build(definition, attachment_uuid)
    submitters = definition['roles'].map { |name| { 'name' => name, 'uuid' => SecureRandom.uuid } }
    fields = definition['fields'].map do |field|
      areas = [field, *field.fetch('additionalAreas', [])].map do |area|
        { 'attachment_uuid' => attachment_uuid, 'page' => area['page'] - 1,
          'x' => area['x'] / 100.0, 'y' => area['y'] / 100.0,
          'w' => area['width'] / 100.0, 'h' => area['height'] / 100.0 }
      end
      { 'uuid' => field['id'], 'name' => field['name'], 'type' => field['kind'],
        'required' => field['required'], 'submitter_uuid' => submitters.find { |s| s['name'] == field['role'] }['uuid'],
        'areas' => areas, 'preferences' => field['fontSize'] ? { 'font_size' => field['fontSize'] } : {} }
    end
    [submitters, fields]
  end
end
