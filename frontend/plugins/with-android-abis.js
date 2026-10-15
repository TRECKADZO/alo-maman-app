/**
 * Plugin Expo : garantit que l'AAB contient les architectures ARM 32 et 64 bits
 * (armeabi-v7a + arm64-v8a) afin que tous les utilisateurs existants puissent
 * effectuer la mise à niveau depuis Google Play. x86/x86_64 conservés pour les émulateurs.
 */
const { withGradleProperties } = require("@expo/config-plugins");

const ABIS = "armeabi-v7a,arm64-v8a,x86,x86_64";

module.exports = function withAndroidAbis(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (p) => !(p.type === "property" && p.key === "reactNativeArchitectures")
    );
    cfg.modResults.push({ type: "property", key: "reactNativeArchitectures", value: ABIS });
    return cfg;
  });
};
