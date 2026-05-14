# react-native-imei-serial-reader

Live-camera OCR scanner for IMEI, Serial Number, Flexible Barcode, and Exact-Match reads.
Port of the Flutter `imei_serial_reader` package (v2.3.2).

## Install

```sh
yarn add react-native-imei-serial-reader \
  react-native-vision-camera \
  react-native-vision-camera-text-recognition \
  react-native-worklets-core
```

iOS:

```sh
cd ios && pod install
```

Add to `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Scan IMEI / Serial Number / Barcode</string>
```

Android — add to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

This library bundles a native Vision Camera Frame Processor Plugin (`frameToJpeg`,
Kotlin + Swift). It's auto-linked — no manual registration on either platform.

### Required patches for peer dependencies

Two of this library's peer dependencies have bugs that break modern RN builds (RN 0.85+):

- `react-native-vision-camera-text-recognition@3.1.1` — Kotlin type-inference error
  in the Android build.
- `react-native-worklets-core@1.6.3` — babel plugin references the deprecated names
  `@babel/plugin-proposal-optional-chaining` and `@babel/plugin-proposal-nullish-coalescing-operator`,
  which modern Babel no longer ships.

This library ships one-line patches for both. You need to wire up
[`patch-package`](https://github.com/ds300/patch-package) in your app so the patches
get applied on install.

In your app:

```sh
yarn add -D patch-package @babel/preset-typescript
mkdir -p patches
cp node_modules/react-native-imei-serial-reader/patches/*.patch patches/
```

Then add a `postinstall` script to your app's `package.json`:

```json
"scripts": {
  "postinstall": "patch-package"
}
```

Run `yarn install` once to apply. From then on, the patches reapply automatically
on every install.

> **Why `@babel/preset-typescript`?** The worklets-core babel plugin calls babel's
> `transformSync` internally with `preset-typescript`. On most package managers this
> ships transitively via `@react-native/babel-preset`, but yarn 4's strict resolution
> requires an explicit install. Adding it as a devDep is safe everywhere.

## Usage

### Component

```tsx
import { ImeiSerialReader, ReaderType } from 'react-native-imei-serial-reader';

<ImeiSerialReader
  parserConfig={{ readerType: ReaderType.Imei }}
  onDone={(values, frame) => {
    console.log('found', values);
    if (frame) console.log('jpeg saved at', frame.uri);
  }}
  captureFrame
/>
```

### Hook (custom UI)

```tsx
import {
  Camera,
  useImeiSerialReader,
  ReaderType,
} from 'react-native-imei-serial-reader';

function Scanner() {
  const { cameraRef, device, isActive, frameProcessor, hasPermission, reload } =
    useImeiSerialReader({
      parserConfig: { readerType: ReaderType.SerialNumber },
      onDone: (values) => console.log(values),
      captureFrame: false,
    });
  if (!hasPermission || !device) return null;
  return (
    <Camera
      ref={cameraRef}
      device={device}
      isActive={isActive}
      frameProcessor={frameProcessor}
      style={{ flex: 1 }}
    />
  );
}
```

## Reader types

| `readerType`                       | What it matches                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `ReaderType.Imei`                  | 15-digit IMEI (regex + Luhn check). Output: deduped IMEI strings.                |
| `ReaderType.SerialNumber`          | Tokens following `Serial Number:` containing both a letter and a digit (≥6 chars).|
| `ReaderType.FlexibleBarcode`       | Any alphanumeric token with letter+digit. Optional `customRegex` / length range. |
| `ReaderType.ExactMatch`            | Exact `targetBarcode` (case-insensitive, whitespace-stripped, substring + word). |

## Frame capture

When `captureFrame: true`, the *exact* frame that produced the OCR match is
JPEG-encoded natively (by the bundled `frameToJpeg` plugin) and written to a
temp file. `onDone` receives the JPEG `Frame` as the second argument. No
`takePhoto()` is involved — no shutter sound, no frame mismatch.

Files live in the platform's temp directory (`NSTemporaryDirectory()` on iOS,
the app's cache dir on Android). The consumer owns deletion.

### Capture mode switch

The library has a fallback path that uses `Camera.takePhoto()` instead of the
native plugin (useful for debugging on platforms where the plugin isn't
installed yet). To switch, edit
[`src/captureMode.ts`](src/captureMode.ts) and change `CAPTURE_MODE` to
`'take-photo'`. Default is `'native-frame'`.

## Migration from Flutter

| Flutter                                  | RN                                       |
| ---------------------------------------- | ---------------------------------------- |
| `onDoneCallback(values, cameraDataModel: x)` | `onDone(values, frame)`                  |
| `cameraDataModel.imageRawData` (raw bytes) | `frame.uri` (already JPEG file)          |
| `cameraDataModel.rotation`                | `frame.orientation` (string)             |
| `resetVisionScreen()`                    | `reload()` from the hook / reload button |
| `ImeiSerialReaderConfig` UI text fields  | Pass as props (e.g. `reloadLabel`)       |

## License

MIT
