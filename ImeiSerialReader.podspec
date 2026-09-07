require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ImeiSerialReader"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["repository"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # GoogleMLKit 9.x requires iOS 15.5.
  s.platforms    = { :ios => 15.5 }
  s.source       = { :git => "https://github.com/vipin-cashify/rn-imei-serial-reader.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
    "cpp/**/*.{hpp,cpp}",
  ]
  s.frameworks = ["AVFoundation", "CoreImage", "ImageIO"]

  load 'nitrogen/generated/ios/ImeiSerialReader+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'GoogleMLKit/TextRecognition', '9.0.0'
  s.dependency 'VisionCamera'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
