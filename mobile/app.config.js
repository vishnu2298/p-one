// Extends app.json with native Firebase / push / contacts setup.
// Firebase files are optional for local web/dev-mode work. For real phone OTP, Google sign-in and push on a device,
// download them from the Firebase console and place them here (or point the env vars at them):
//   android: google-services.json   ios: GoogleService-Info.plist
const fs = require('fs');
const base = require('./app.json').expo;

module.exports = () => {
  const androidFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const iosFile = process.env.GOOGLE_SERVICE_INFO_PLIST || './GoogleService-Info.plist';
  const hasAndroid = fs.existsSync(androidFile);
  const hasIos = fs.existsSync(iosFile);

  const plugins = [
    ...base.plugins,
    ['expo-contacts', { contactsPermission: 'Pick friends and family to invite. Your contacts never leave your phone.' }],
    ['expo-notifications', { color: '#1747C6' }],
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
  ];
  if (hasAndroid || hasIos) plugins.push('@react-native-firebase/app', '@react-native-firebase/auth', '@react-native-firebase/messaging');
  if (process.env.GOOGLE_IOS_URL_SCHEME) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME }]);
  else plugins.push('@react-native-google-signin/google-signin');

  return {
    ...base,
    ios: { ...base.ios, ...(hasIos ? { googleServicesFile: iosFile } : {}) },
    android: { ...base.android, ...(hasAndroid ? { googleServicesFile: androidFile } : {}) },
    plugins,
  };
};
