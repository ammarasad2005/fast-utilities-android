/**
 * Expo config plugin: Google Services (FCM) wiring that survives prebuild.
 *
 * This repo does not commit the generated /android directory — gradle files
 * are recreated by `expo prebuild` every time. Injecting the plugin wiring
 * here keeps `google-services.json` support declarative:
 *
 *   1. buildscript classpath  com.google.gms:google-services  in android/build.gradle
 *   2. conditional `apply plugin: "com.google.gms.google-services"` at the
 *      bottom of android/app/build.gradle — applied ONLY when
 *      android/app/google-services.json exists, so builds without the file
 *      behave exactly as before (PushSetupModule no-ops in that case).
 *
 * Registration: "plugins": [ ..., "./plugins/withGoogleServices" ] in app.json.
 */
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const CLASSPATH = "classpath('com.google.gms:google-services:4.4.2')";

const APPLY_BLOCK = `
// FCM wiring applies only when google-services.json is present (drop the real
// file in this directory from Firebase console). Keeping it conditional means
// builds without the file behave exactly as before.
if (file("google-services.json").exists()) {
    apply plugin: "com.google.gms.google-services"
}
`;

module.exports = function withGoogleServices(config) {
  config = withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.gms:google-services')) {
      const anchor = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')";
      cfg.modResults.contents = cfg.modResults.contents.replace(
        anchor,
        `${anchor}\n    ${CLASSPATH}`
      );
    }
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.gms.google-services')) {
      cfg.modResults.contents = cfg.modResults.contents.trimEnd() + '\n' + APPLY_BLOCK + '\n';
    }
    return cfg;
  });

  return config;
};
