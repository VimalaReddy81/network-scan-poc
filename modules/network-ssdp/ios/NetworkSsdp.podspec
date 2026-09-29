Pod::Spec.new do |s|
  s.name           = 'NetworkSsdp'
  s.version        = '1.0.0'
  s.summary        = 'SSDP (UPnP) search for the network scan'
  s.description    = 'Sends an SSDP M-SEARCH over UDP and collects the replies.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
