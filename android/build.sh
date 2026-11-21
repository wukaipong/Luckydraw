#!/usr/bin/env bash
# Manual APK pipeline: javac -> d8 -> aapt2 -> zipalign -> apksigner (no Gradle needed)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
JDK="$(ls -d "$ROOT"/tools/jdk17/*/bin | head -1)"
BT="$(ls -d "$ROOT"/tools/bt/*/ | head -1)"
PJ="$(find "$ROOT/tools/platform" -name android.jar | head -1)"
echo "JDK=$JDK"
echo "BT=$BT"
echo "PLATFORM=$PJ"
OUT="$ROOT/android/build"
rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex" "$ROOT/apk"

"$JDK/javac" -source 8 -target 8 -bootclasspath "$PJ" -classpath "$PJ" \
  -d "$OUT/classes" "$ROOT/android/src/org/rileywu/luckydraw/MainActivity.java"

"$JDK/java.exe" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --lib "$PJ" --output "$OUT/dex" \
  "$OUT/classes/org/rileywu/luckydraw/"*.class

"$BT/aapt2.exe" compile --dir "$ROOT/android/res" -o "$OUT/res.zip"
"$BT/aapt2.exe" link -o "$OUT/base.apk" -I "$PJ" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -R "$OUT/res.zip" -A "$ROOT/android/assets" \
  --min-sdk-version 22 --target-sdk-version 34 \
  --version-code 1 --version-name 1.0 --auto-add-overlay

(cd "$OUT/dex" && "$JDK/jar.exe" uf "$OUT/base.apk" classes.dex)

"$BT/zipalign.exe" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

KS="$ROOT/android/debug.keystore"
if [ ! -f "$KS" ]; then
  "$JDK/keytool.exe" -genkeypair -keystore "$KS" -alias debug -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass android -keypass android \
    -dname "CN=Lucky Draw Debug, O=RileyWu, C=HK"
fi
"$JDK/java.exe" -jar "$BT/lib/apksigner.jar" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$ROOT/apk/luckydraw-tv.apk" "$OUT/aligned.apk"
"$JDK/java.exe" -jar "$BT/lib/apksigner.jar" verify "$ROOT/apk/luckydraw-tv.apk" && echo "SIGNATURE OK"
"$BT/aapt2.exe" dump badging "$ROOT/apk/luckydraw-tv.apk" | head -6
ls -la "$ROOT/apk"