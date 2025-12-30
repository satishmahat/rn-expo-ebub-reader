const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .epub to asset extensions
config.resolver.assetExts.push('epub');

module.exports = config;

