const path = require('path');

// npm installs expo-modules-core under expo/node_modules, where jest-expo's setup can't find it.
const expoModulesCore = path.dirname(
  require.resolve('expo-modules-core/package.json', { paths: [path.dirname(require.resolve('expo/package.json'))] })
);

module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^expo-modules-core$': expoModulesCore,
    '^expo-modules-core/(.*)$': `${expoModulesCore}/$1`,
  },
};
