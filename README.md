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
| `ReaderType.PanCard`               | Indian PAN card. Output: the PAN number, plus named fields (see below).          |
| `ReaderType.AadhaarCard`           | Indian Aadhaar card, front side. Output: the Aadhaar number, plus named fields.   |

## PAN card reader

Reads an Indian PAN card and returns named fields via the third `onDone`
argument. Works across all card eras (pre-2017, 2017+, PAN 2.0) — every era
prints the same bilingual labels, and extraction is anchored to those labels
rather than to absolute positions.

```tsx
<ImeiSerialReader
  parserConfig={{ readerType: ReaderType.PanCard }}
  onDone={(values, frame, fields) => {
    console.log(values[0]);        // 'ABGPR1484A'
    console.log(fields?.name);     // cardholder name
    console.log(fields?.fatherName);
    console.log(fields?.dob);      // normalised to DD-MM-YYYY
    console.log(fields?.entityType); // 'Individual', 'Company', …
  }}
/>
```

`fields` keys: `panNumber`, `name`, `fatherName`, `dob`, `entityType`.

By default every field must resolve before a match is reported. Set
`requireAllFields: false` to accept a valid PAN number alone and take the
remaining fields best-effort.

**Accuracy note.** A PAN's tenth character is a check digit, but the algorithm
behind it is not published by the Income Tax Department — so unlike IMEI
(which self-validates via Luhn), a format-valid PAN cannot be proven correct.
The parser compensates with position-aware confusable repair: PAN positions
are typed (1–5 and 10 are letters, 6–9 are digits), so `O`↔`0`, `I`↔`1`,
`S`↔`5`, `B`↔`8` and similar are corrected per position. Treat a scanned PAN
as high-confidence, not verified.

Non-individual cards (company, HUF, trust — any PAN whose 4th character is not
`P`) carry no father's name, so `fatherName` is not required for them.

## Aadhaar card reader

Reads the **front side** of an Indian Aadhaar card. The address is on the back
and is not supported.

```tsx
<ImeiSerialReader
  parserConfig={{ readerType: ReaderType.AadhaarCard }}
  scanRegion={{}}
  onDone={(values, frame, fields) => {
    console.log(values[0]);          // '234567890123' — canonical 12 digits
    console.log(fields?.name);
    console.log(fields?.dob);        // 'DD-MM-YYYY', when a full date is printed
    console.log(fields?.yearOfBirth);// set instead of dob on year-only cards
    console.log(fields?.gender);     // 'MALE' | 'FEMALE' | 'TRANSGENDER'
  }}
/>
```

`fields` keys: `aadhaarNumber`, `name`, `dob` **or** `yearOfBirth`, `gender`,
and `masked` (see below). The number is returned as 12 unformatted digits so it
stays comparable — group it for display in your own UI.

**Verified, not just format-matched.** The 12th digit of every Aadhaar number is
a Verhoeff checksum, and UIDAI never issues a number starting with `0` or `1`.
Both are checked, so a candidate is *mathematically* validated — this is
stronger than the PAN reader can manage, since PAN's check-digit algorithm is
unpublished. It also lets OCR confusable repair be applied aggressively
(`O`→`0`, `I`→`1`, `S`→`5`, `B`→`8`, …): a wrong repair simply fails the
checksum.

**Date of birth may be a year only.** UIDAI prints just the year when the date
is recorded as *declared* or *approximate*. In that case `yearOfBirth` is set
and `dob` is absent — the reader never fabricates `01-01-YYYY`.

**Masked Aadhaar is rejected, not parsed.** On a masked card (`XXXX XXXX 1234`)
only the last four digits are real. The reader returns `fields.masked === 'true'`
with **no** `aadhaarNumber` and an empty `values`, so a partial number can never
be mistaken for a complete one. Treat it as "ask for an unmasked card", not as a
failed scan.

**Positioning.** Both the PVC card and the perforated card on an e-Aadhaar
printout are ID-1, so the default `scanRegion={{}}` fits. For an e-Aadhaar sheet
the user positions the **card portion** inside the cutout — not the whole page.
Cropping to it is what keeps the enrolment number, download date, and address
block out of the OCR input.

**VID is never returned.** The 16-digit Virtual ID printed below the Aadhaar
number is explicitly excluded — a 12-digit slice of it could otherwise pass the
checksum by coincidence.

## Scan region overlay

Shows a card-shaped cutout over the preview and **crops the frame to it
natively before OCR**. Background text outside the cutout cannot produce a
false match, the JPEG is smaller, and ML Kit has less area to scan — so it
improves accuracy and speed together.

```tsx
<ImeiSerialReader
  parserConfig={{ readerType: ReaderType.PanCard }}
  scanRegion={{}}              // ID-1 defaults
  onDone={(values, frame, fields) => { /* … */ }}
/>
```

Pass `{}` for the defaults, or override any field:

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `aspectRatio` | `1.585` | Cutout width ÷ height. Default is ISO/IEC 7810 ID-1 (PAN, Aadhaar, credit cards). |
| `widthPercent` | `0.88` | Cutout width as a fraction of the view width. |
| `verticalCenter` | `0.5` | Vertical centre as a fraction of view height. |
| `dimOpacity` | `0.6` | Opacity of the dimmed area outside the cutout. |
| `cornerColor` | `'#ffffff'` | Corner bracket colour. |
| `cornerLength` | `28` | Bracket arm length (dp). |
| `cornerWidth` | `3` | Bracket stroke width (dp). |
| `borderRadius` | `0` | Corner-bracket radius (dp). Sharp by default, to match the dim's square corners. |
| `hintText` | `'Fit the card inside the frame'` | Hint above the cutout. Pass `''` to hide. |
| `enabled` | `true` | Master switch. |

Works with every reader type, not just PAN — a tighter region helps IMEI and
serial scanning too. Omit `scanRegion` entirely to scan the full frame.

**`resizeMode` changes when a scan region is active.** Vision Camera defaults
to `'cover'`, which scales the buffer to fill the view and centre-crops the
overflow — roughly 18% of a 16:9 buffer is off-screen on a 19.5:9 phone. That
puts a hidden scale and offset between screen and buffer coordinates. Setting
a scan region therefore defaults the preview to `'contain'`, which makes that
correction the identity at the cost of letterbox bars. Override with the
`resizeMode` prop if you prefer the fuller preview.

`frame.width`/`frame.height` describe the **cropped** image when a scan region
is active, not the sensor frame.

## Frame capture

When `captureFrame: true`, the *exact* frame that produced the OCR match is
JPEG-encoded natively (by the bundled `frameToJpeg` plugin) and written to a
temp file. `onDone` receives the JPEG `Frame` as the second argument. No
`takePhoto()` is involved — no shutter sound, no frame mismatch.

Files live in the platform's temp directory (`NSTemporaryDirectory()` on iOS,
the app's cache dir on Android).

A JPEG is written for *every* processed frame, not just matching ones — the
file is the OCR input, not merely the capture artefact. The plugin deletes the
previous frame's file before writing the next, so at most one scratch file
exists at a time during a scan. The file handed to `onDone` is the last one
written and is left in place; the consumer owns deletion of that one.

### Capture mode switch

The library has a fallback path that uses `Camera.takePhoto()` instead of the
native plugin (useful for debugging on platforms where the plugin isn't
installed yet). To switch, edit
[`src/captureMode.ts`](src/captureMode.ts) and change `CAPTURE_MODE` to
`'take-photo'`. Default is `'native-frame'`.

## Migration from Flutter

| Flutter                                  | RN                                       |
| ---------------------------------------- | ---------------------------------------- |
| `onDoneCallback(values, cameraDataModel: x)` | `onDone(values, frame, fields)`          |
| `cameraDataModel.imageRawData` (raw bytes) | `frame.uri` (already JPEG file)          |
| `cameraDataModel.rotation`                | `frame.orientation` (string)             |
| `resetVisionScreen()`                    | `reload()` from the hook / reload button |
| `ImeiSerialReaderConfig` UI text fields  | Pass as props (e.g. `reloadLabel`)       |

## License

MIT
