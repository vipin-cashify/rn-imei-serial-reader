# react-native-imei-serial-reader

Live-camera OCR scanner for IMEI, Serial Number, Flexible Barcode, Exact-Match,
PAN card, and Aadhaar card reads.
Port of the Flutter `imei_serial_reader` package (v2.3.2).

## Install

```sh
yarn add react-native-imei-serial-reader react-native-vision-camera react-native-nitro-modules react-native-nitro-image
```

Requires `react-native-vision-camera` ≥ 5.2.0 and `react-native-nitro-modules`
0.37.x (the checked-in nitrogen output is coupled to that nitro minor). No babel
plugin, no worklets, no patches.

iOS (minimum deployment target 15.5):

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

## Usage

> **Example app:** `example/` has not been migrated to VisionCamera 5 yet and will not build against this version.

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

`Camera` comes from `react-native-vision-camera` — this package does not
re-export it.

```tsx
import { Camera } from 'react-native-vision-camera';
import { useImeiSerialReader, ReaderType } from 'react-native-imei-serial-reader';

function Scanner() {
  const {
    cameraRef,
    device,
    isActive,
    outputs,
    hasPermission,
    resizeMode,
    onCameraLayout,
    onCameraStarted,
    onCameraError,
  } = useImeiSerialReader({
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
      outputs={outputs}
      // REQUIRED. The crop rect and the overlay live in interface space;
      // VisionCamera 5 defaults to 'device', which rotates the analysis stream
      // when the operator tilts a portrait-locked phone.
      orientationSource="interface"
      resizeMode={resizeMode}
      onLayout={(e) =>
        onCameraLayout(e.nativeEvent.layout.width, e.nativeEvent.layout.height)
      }
      onStarted={onCameraStarted}
      onError={onCameraError}
      style={{ flex: 1 }}
    />
  );
}
```

`useImeiSerialReader` returns `{ cameraRef, isActive, reload, error, device, outputs, bufferSize, hasPermission, requestPermission, onCameraLayout, onCameraStarted, onCameraError, resizeMode }` — pass `outputs` to `<Camera outputs>` (there is no `frameProcessor` or `format` anymore; VisionCamera 5's Nitro `CameraOutput` replaces both).

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

When `captureFrame: true`, the native `OcrRecognizer` JPEG-encodes the exact
frame it just ran OCR on and reports the file path as `jpegPath`. `onDone`
receives it as a `Frame` (`{ uri, width, height, orientation }`) in the second
argument. No `takePhoto()` is involved — no shutter sound, no frame mismatch.

Files live in the platform's temp directory (`NSTemporaryDirectory()` on iOS,
the app's cache dir on Android).

A JPEG is written for *every* analysed frame while `captureFrame` is enabled,
not just matching ones — the file is the OCR input, not merely the capture
artefact. The native side keeps each file for a 3 s retention window and prunes
older ones as it writes, so only the last handful of frames are on disk during
a scan.

**The delivered file is guaranteed to exist for at least 3 s after `onDone` and
for as long as the recognizer stays paused; copy or consume it promptly.** (A
match pauses the recognizer, and nothing is pruned while it is paused, so in
practice the file survives until scanning resumes. Nothing is deleted on
teardown either — the OS reclaims the temp directory.)

## Migrating from 0.1.x

0.2.0 is a rewrite on top of VisionCamera 5. `ImeiSerialReader`'s props, the
`ReaderType`s, the parsers and the scan-region geometry are unchanged; the
plumbing under them is not.

**Dependencies.** Peers are now `react-native-vision-camera` ≥ 5.2 and
`react-native-nitro-modules` ^0.37. The consuming app also needs
`react-native-nitro-image` (VisionCamera 5 depends on it). Removed:
`react-native-vision-camera` 4.x, `react-native-vision-camera-text-recognition`,
`react-native-worklets-core`, the two peer-dependency patch files, and the
worklets babel plugin — delete all of them from the app.

**iOS deployment target is now 15.5** (was 13.0).

**`useImeiSerialReader`'s return shape changed.** `format` and `frameProcessor`
are gone; VisionCamera 5's Nitro `CameraOutput` replaces both:

| 0.1.x | 0.2.0 |
| ----- | ----- |
| `format` (from `useCameraFormat`) | — resolution is negotiated from the output |
| `frameProcessor` | `outputs` → `<Camera outputs={outputs}>` |
| — | `bufferSize` — analysis size as displayed (portrait) |
| `onInitialized` (app-side) | `onCameraStarted` → `<Camera onStarted>` |
| — | `onCameraError` → `<Camera onError>` |

`cameraRef`, `isActive`, `reload`, `error`, `device`, `hasPermission`,
`requestPermission`, `onCameraLayout` and `resizeMode` are unchanged. Hook
consumers must also pass `orientationSource="interface"` to `<Camera>` (see the
hook example above).

**`Frame.orientation` is informational and platform-specific.** It reports what
the analysed frame's source orientation was — Android maps the sensor rotation,
iOS reports the interface orientation — and the two will not always agree for
the same physical pose. Do not derive a rotation from it: `frame.width`,
`frame.height` and every box handed to the parsers are already upright.

**`captureFrame` files now live in a retention window.** 0.1.x produced the JPEG
through a separate `frameToJpeg` frame-processor plugin; the OCR output now
writes it itself, keeps it for at least 3 s, and never prunes while the
recognizer is paused — see [Frame capture](#frame-capture). `Frame` still has
the same `{ uri, width, height, orientation }` shape.

**The `example/` app has not been migrated** and will not build against 0.2.0.
Validate changes by building a consuming app instead.

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
