# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this library is

A React Native port of the Flutter `imei_serial_reader` package (v2.3.2). Live-camera OCR scanner for IMEI / Serial Number / Flexible Barcode / Exact-Match reads.

**TypeScript core + a small native Frame Processor Plugin.** All OCR / camera plumbing is delegated to peer dependencies. The only native code we own is `frameToJpeg` — a Kotlin (Android) + Swift+ObjC++ (iOS) Vision Camera plugin that JPEG-encodes the matching frame directly inside the worklet runtime and returns just the file path. Lives in [`android/`](android/) and [`ios/`](ios/).

Package is consumed **source-style** for the TS side: `react-native`, `source`, and `types` in `package.json` all point at `src/index.ts`. There is no JS build step — Metro/TS compile the consumer's tree directly. Native code is built once per platform by the consumer's app (autolinked via [`react-native.config.js`](react-native.config.js) on Android and [`react-native-imei-serial-reader.podspec`](react-native-imei-serial-reader.podspec) on iOS).

## Commands

```sh
yarn typecheck              # tsc --noEmit
yarn lint                   # eslint src/**/*.{ts,tsx}
yarn test                   # jest (ts-jest preset, node env)
yarn test path/to/file.test.ts          # run one test file
yarn test -t "matches IMEI"             # run tests by name
yarn example android        # = yarn --cwd example android
yarn example ios            # = yarn --cwd example ios
yarn example start          # metro for the example app
```

Tests live only at `src/**/__tests__/**/*.test.ts` (parsers + validateParserConfig). There are no tests for components, hooks, adapters, or native code — those run inside the Vision Camera worklet/runtime which Jest can't host.

## Architecture

### Frame processing pipeline

The whole library is one pipeline plumbed through a Vision Camera frame processor worklet. Reading [`src/hooks/useImeiSerialReader.ts`](src/hooks/useImeiSerialReader.ts) end-to-end is the fastest way in.

```
Camera frame (worklet thread)
  └─ useFrameProcessor + runAtTargetFps(10)
       ├─ busy guard (isBusy shared value)
       ├─ grace period after activate (GRACE_MS=1s)
       └─ runAsync(frame, ...)               ← preview stays smooth
            ├─ scanText(frame)               ← react-native-vision-camera-text-recognition
            ├─ toRecognizedText(raw)         ← src/adapters/mlkitAdapter.ts
            ├─ parser(rt)                    ← one of src/parsers/*.ts
            └─ if values found:
                 ├─ if CAPTURE_MODE === 'native-frame' && captureFrame:
                 │    └─ nativeFrameToJpeg(frame)   ← bundled native plugin
                 │         ├─ Android: YUV→NV21→YuvImage.compressToJpeg + EXIF rotation
                 │         └─ iOS: CIContext.writeJPEGRepresentation (CIImage.oriented)
                 │         → returns { path, width, height, orientation }
                 └─ Worklets.createRunOnJS(handleMatch)
                      └─ JS thread: build Frame { uri: file://path, ... }, onDone(values, frame)
```

`ImeiSerialReader` (the component) is a thin wrapper around `useImeiSerialReader` + a default `<Camera>` render + a `ReloadButton`. Custom UIs should consume the hook directly.

### Capture mode toggle

[`src/captureMode.ts`](src/captureMode.ts) exports a single `CAPTURE_MODE` const, used by both the hook and the component. Two values:

- `'native-frame'` (default) — worklet calls the bundled `frameToJpeg` native plugin on the matching frame, ~50–100ms, exact-frame guarantee.
- `'take-photo'` — JS thread calls `Camera.takePhoto()` after the match, ~460ms (Android Camera2 pipeline floor), captured frame is taken ~150–300ms after the OCR match. Kept as a debug fallback in case the native plugin isn't installed.

The toggle is a module-level const intentionally: changing it requires a Metro reload, not a runtime decision. Hook/component API is unchanged — consumers don't see the switch.

### Parsers

Each `ReaderType` maps to a `ParserFn: (RecognizedText) => string[] | null` returned by `createParser(config)` in [`src/parsers/index.ts`](src/parsers/index.ts). Validation happens at create time via [`validateParserConfig`](src/validateParserConfig.ts). The four parsers (`imeiReader`, `serialNoReader`, `flexibleBarcodeReader`, `exactMatchBarcodeReader`) all run inside the frame-processor worklet — see worklet rules below.

The OCR shape parsers consume (`RecognizedText` in [`src/parsers/types.ts`](src/parsers/types.ts)) is intentionally decoupled from the MLKit plugin's response. `toRecognizedText` in the mlkit adapter is the only place that knows the plugin's `Text[] / { resultText, blocks: [frame, cornerPoints, lines, languages, blockText] }` shape — if you upgrade the plugin, change that file.

### The native `frameToJpeg` plugin

The reason this plugin exists: `vision-camera-resize-plugin`'s `resize()` returns an `ArrayBuffer` with JSI runtime affinity, which crashes when called from `runAsync`'s separate worklet runtime. Our plugin instead returns only **primitives** (`path: string`, `width`, `height`, `orientation`) — those cross worklet runtimes safely, so capture can happen inside `runAsync` and the preview stays smooth.

- **Android** ([`android/src/main/java/com/cashify/imeireader/FrameToJpegPlugin.kt`](android/src/main/java/com/cashify/imeireader/FrameToJpegPlugin.kt)): YUV_420_888 → NV21 via plane copy (handles `rowStride` / `pixelStride`), `YuvImage.compressToJpeg`, write to `File.createTempFile`, set `ExifInterface.TAG_ORIENTATION` from `frame.imageProxy.imageInfo.rotationDegrees`. EXIF avoids a decode/rotate/encode round-trip — RN's `<Image>` honors EXIF orientation on load.
- **iOS** ([`ios/FrameToJpegPlugin.swift`](ios/FrameToJpegPlugin.swift)): `CMSampleBufferGetImageBuffer` → `CIImage` → `.oriented(forExifOrientation:)` → `CIContext.writeJPEGRepresentation(of:to:colorSpace:options:)` writes the file in one call. Path is in `NSTemporaryDirectory()`.
- **Registration**: Android via `FrameProcessorPluginRegistry.addFrameProcessorPlugin` in [`ImeiSerialReaderPackage.kt`](android/src/main/java/com/cashify/imeireader/ImeiSerialReaderPackage.kt)'s companion-object init; iOS via `+ (void) load` in [`FrameToJpegPlugin.mm`](ios/FrameToJpegPlugin.mm). Both autolinked.

Consumer owns deletion of the JPEG files (just like the previous flow).

## Worklet rules (read before editing parsers, adapters, or the hook)

The frame processor, all parsers, `toRecognizedText`, and `nativeFrameToJpeg` execute on the **worklet runtime** (separate JS VM with its own globals). The worklets-core babel plugin auto-workletizes functions whose first statement is `'worklet';`. Three traps come up repeatedly in this codebase; expect to hit them:

1. **No file-local helpers in worklets.** The plugin auto-workletizes the directly-called function but does NOT reliably carry private file-scope helper functions into the worklet runtime. Every parser inlines its logic — e.g. `processImei` inlines its Luhn check. Do not factor "for cleanliness" without testing on-device.

2. **RegExp must be constructed inside the worklet body.** Only string sources can be safely captured into worklet scope (see the `*_SRC` constants in each parser). The `RegExp` objects are built inside the function body so `.test` / `.exec` / `.matchAll` prototype methods exist in the worklet VM.

3. **Cross-runtime affinity for native plugin returns.** `runAsync` runs on a separate worklet runtime from the main frame processor. Anything returned from a Vision Camera native plugin that's a JSI host object — `ArrayBuffer`, `Uint8Array`, custom host classes — is bound to the calling runtime and crashes when crossed. **Primitives (strings, numbers, booleans) and plain JS objects/arrays cross safely.** This is exactly why `nativeFrameToJpeg` returns `{ path: string, width: number, ... }` rather than pixel bytes — and why `scanText` (returning a plain object tree) works in `runAsync` but the resize plugin (returning ArrayBuffer) does not.

## Example app

[`example/`](example/) is a sample RN 0.85 app that consumes the library by path:

- [`example/metro.config.js`](example/metro.config.js) adds the repo root as a `watchFolders` entry, blocklists the library's own copies of peer dependencies (preventing duplicate-React errors), and routes those peers to `example/node_modules`.
- [`example/babel.config.js`](example/babel.config.js) uses `babel-plugin-module-resolver` to alias `react-native-imei-serial-reader` → `../src/index.ts` so Metro picks up source changes with no rebuild.
- [`example/package.json`](example/package.json) declares the lib as `"link:.."` and runs `patch-package --patch-dir ../patches` postinstall to apply peer-dep patches.

If you modify `src/`, the example app picks it up on Metro reload — no `yarn install` needed. **Native code changes require an Android/iOS rebuild** — Metro doesn't watch Kotlin/Swift.

## Required peer-dep patches

Two peer dependencies break modern RN builds and the library ships one-line patches in [`patches/`](patches/):

- `react-native-vision-camera-text-recognition+3.1.1.patch` — fixes a Kotlin type-inference error (`HashMap<String, Any>?` → `HashMap<String, Any?>?`) that prevents Android compile on RN 0.85.
- `react-native-worklets-core+1.6.3.patch` — replaces the babel plugin's references to the retired `@babel/plugin-proposal-{optional-chaining,nullish-coalescing-operator}` with the current `plugin-transform-*` names.

Consumers wire up `patch-package` and copy these into their app's `patches/` directory — see [README.md](README.md) for the exact steps. **When bumping either peer dep, re-check whether the patch is still needed and update README.md accordingly.**

## Conventions worth knowing

- Peer-dep versions in `package.json` reflect what the library is tested against; the example pins exact versions. Update both together when bumping.
- The `ReaderType` "enum" is a `const` object + derived type union (not a TS `enum`) so it survives bundling cleanly.
- [`validateParserConfig`](src/validateParserConfig.ts) is the single source of truth for which fields are valid with which reader type. New reader-type fields must be checked here and surface readable error messages (the existing ones use the `'ParserConfig ----'` prefix).
- Android package namespace is `com.cashify.imeireader` (Kotlin) — keep new native files under that. The iOS pod name is `react-native-imei-serial-reader` (matching the npm package).
