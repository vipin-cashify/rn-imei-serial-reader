/**
 * Capture mode for the matching frame:
 *   'native-frame' → Worklet calls the bundled native `frameToJpeg` plugin on
 *                    the exact matching frame. ~50-100ms, exact-frame match
 *                    guarantee. Default.
 *   'take-photo'   → JS thread calls `Camera.takePhoto()` after match. ~460ms,
 *                    the captured frame is taken ~150-300ms after the OCR
 *                    match (slight scene drift possible). Kept as a fallback
 *                    in case the native plugin needs to be bypassed during
 *                    debugging — flip this constant and reload Metro.
 */
export const CAPTURE_MODE: 'native-frame' | 'take-photo' = 'native-frame';
