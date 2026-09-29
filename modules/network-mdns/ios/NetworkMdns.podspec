Pod::Spec.new do |s|
  s.name           = 'NetworkMdns'
  s.version        = '1.0.0'
  s.summary        = 'Bonjour (mDNS) service browser for the network scan'
  s.description    = 'Browses and resolves Bonjour services with NetServiceBrowser.'
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
