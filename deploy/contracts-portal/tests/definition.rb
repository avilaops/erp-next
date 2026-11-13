# frozen_string_literal: true
# Pure validator checks: no Rails environment, database, network or application data.
source = File.expand_path('../overlay/lib/avila_template_definition.rb', __dir__)
source = '/app/lib/avila_template_definition.rb' unless File.file?(source)
require source

def definition_with(count)
  { 'name' => 'Bounded contract fixture', 'pages' => 17, 'roles' => ['Cliente'],
    'fields' => Array.new(count) do |index|
      { 'id' => SecureRandom.uuid, 'name' => "Field #{index}", 'role' => 'Cliente',
        'kind' => index.zero? ? 'signature' : 'text', 'required' => index.zero?,
        'page' => 1, 'x' => 5, 'y' => 10, 'width' => 80, 'height' => 5 }
    end }
end

def accepts(definition, message)
  AvilaTemplateDefinition.validate(definition)
rescue AvilaTemplateDefinition::Invalid
  raise message
end

def rejects(definition, message)
  begin
    AvilaTemplateDefinition.validate(definition)
  rescue AvilaTemplateDefinition::Invalid
    return
  end
  raise message
end

[1, 100, 148, 200].each do |count|
  definition = definition_with(count)
  accepts(definition, "Expected #{count} fields to be supported")
  submitters, fields = AvilaTemplateDefinition.build(definition, 'document')
  raise 'Field or role lost in conversion' unless fields.size == count && submitters.size == 1
end
rejects(definition_with(201), '201 fields must exceed the bounded limit')
rejects(definition_with(0), 'An empty model must be rejected')

[
  ->(value) { value['fields'][1]['width'] = 101 },
  ->(value) { value['fields'][1]['role'] = 'Unknown' },
  ->(value) { value['fields'][1]['page'] = 18 },
  ->(value) { value['fields'][1]['fontSize'] = 5 },
  ->(value) { value['fields'][1]['name'] = value['fields'][0]['name'] },
  ->(value) { value['fields'][0]['required'] = false }
].each do |change|
  definition = definition_with(148)
  change.call(definition)
  rejects(definition, 'Increasing the field cap must retain all existing validation rules')
end

definition = definition_with(148)
definition['fields'][0]['additionalAreas'] = [*2..17].map do |page|
  { 'page' => page, 'x' => 5, 'y' => 10, 'width' => 80, 'height' => 5 }
end
accepts(definition, 'Repeated areas on all 17 pages must remain supported')
_, fields = AvilaTemplateDefinition.build(definition, 'document')
raise 'Repeated signature areas lost' unless fields.first['areas'].size == 17

puts 'Definition validation passed: 148/200 fields, 201-field boundary, retained guards and 17-page repeated areas.'
