// react-native-zeroconf doesn't deliver events on iOS under the New Architecture and can crash
// the app, so it's linked on Android only. iOS uses modules/network-mdns instead.
module.exports = {
  dependencies: {
    'react-native-zeroconf': {
      platforms: { ios: null },
    },
  },
};
