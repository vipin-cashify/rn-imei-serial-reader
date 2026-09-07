# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this library is

A React Native port of the Flutter `imei_serial_reader` package. Live-camera OCR scanner for IMEI / Serial Number / Flexible Barcode / Exact-Match / PAN / Aadhaar reads, built on **react-native-vision-camera 5** and **Nitro Modules**.

**TypeScript core + one native Nitro Hybrid Object.** The parsers, scan-region geometry and the `ImeiSerialReader` component are TypeScript. The only native code we own is `OcrRecognizer` — a Nitro object (Kotlin + Swift) that wraps a VisionCamera 5 `CameraOutput` running MLKit Text Recognition. There are no frame processors and no worklets.

Package is consumed **source-style** for the TS side: `react-native`, `source`, and `types` in `package.json` point at `src/index.ts`. Native code is built by the consumer's app (autolinked via `react-native.config.js` on Android and `ImeiSerialReader.podspec` on iOS; Nitro registration via `nitro.json`).

## Commands

```sh
yarn typecheck              # tsc --noEmit
yarn lint                   # eslint src/**/*.{ts,tsx}
yarn test                   # jest (ts-jest preset, node env)
yarn specs                  # nitrogen — regenerate nitrogen/generated/** after editing src/specs/*.nitro.ts
```

Tests live at `src/**/__tests__/**/*.test.ts` (parsers, scan region, ocrAdapter). Native code has no unit tests; it is verified by building a consuming app.

**After editing any `src/specs/*.nitro.ts` file, run `yarn specs` and commit `nitrogen/generated/**`.** Consumers do not run nitrogen.

## Architecture

```
<Camera outputs={[recognizer.output]}>        (VisionCamera 5)
  └─ OcrCameraOutput (native, Kotlin/Swift)
       ├─ throttle to targetFps, drop while busy or paused
       ├─ crop to the scan region (Android: in buffer space via rotationDegrees; iOS: after .oriented)
       ├─ optional JPEG of the analysed frame (captureJpeg)
       ├─ MLKit Text Recognition (Latin)
       └─ onTextRecognized(OcrFrame { blocks[lines[elements]] + boxes, width, height, orientation, jpegPath? })
            └─ JS: toRecognizedText → createParser(config)(rt) → onDone(values, frame?, fields?)
```

- `src/specs/OcrRecognizer.nitro.ts`, `src/specs/OcrRecognizerFactory.nitro.ts` — the Nitro contract.
- `src/native/createOcrRecognizer.ts` — JS entry point.
- `src/hooks/useImeiSerialReader.ts` — creates the recognizer, wires crop rect / pause / grace period, runs the parser.
- `src/adapters/ocrAdapter.ts` — `OcrFrame` → `RecognizedText` (zero boxes become `undefined`).
- `android/src/main/java/com/margelo/nitro/imeiserialreader/` — `HybridOcrRecognizerFactory`, `HybridOcrRecognizer`, `OcrCameraOutput`, `YuvCrop`, `MlTextExtensions`.
- `ios/` — `HybridOcrRecognizerFactory`, `HybridOcrRecognizer`, `OcrCameraOutput`, `OcrCrop`, extensions.

- On iOS the output **physically rotates its `AVCaptureConnection`** to `outputOrientation` (VisionCamera 5 only applies `mirrorMode` to a custom output, and MLKit's Latin recogniser is not rotation invariant), so buffers arrive upright and the per-frame `.oriented(...)` is a no-op; a software fallback corrects each frame if the connection refuses.
- Written JPEGs (`captureJpeg`) are kept for a **3 s retention window** and are never pruned while paused or on teardown — the previous "delete the last file on each write" raced the delivery of a matched frame to JS.

Mutable runtime state (crop rect, paused) goes through `OcrRecognizer.setCropRect/setPaused` because Nitro cannot subclass VisionCamera's `CameraOutput` spec in Swift.

### Parsers

Each `ReaderType` maps to a `ParserFn: (RecognizedText) => ParserResult | null` returned by `createParser(config)` in `src/parsers/index.ts`. Validation happens at create time via `validateParserConfig`. Parsers run on the JS thread. Document parsers (PAN, Aadhaar) use line geometry (`line.box`) — the adapter must keep passing boxes through.

## Conventions

- Nitro type names are prefixed `Ocr…` to avoid Swift clashes with MLKit's `TextRecognizer` / `TextRecognizerOptions` / `TextBlock`.
- Kotlin lives in `com.margelo.nitro.imeiserialreader` (the nitrogen namespace). iOS pod/module name is `ImeiSerialReader`.
- The `ReaderType` "enum" is a `const` object + derived type union so it survives bundling cleanly.
- `validateParserConfig` is the single source of truth for which fields are valid with which reader type.
- The `example/` app is stale (still on VisionCamera 4) — do not use it to validate changes; build a consuming app instead.
