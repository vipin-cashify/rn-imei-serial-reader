import { Buffer as BufferPolyfill } from 'buffer';
import jpegJs from 'jpeg-js';
import RNFS from 'react-native-fs';

// jpeg-js references `Buffer` as a global (not as an import). React Native
// has no built-in Buffer, so we install the npm `buffer` polyfill onto the
// global once at library load. Guarded so we don't clobber a host-provided one.
const _g = globalThis as { Buffer?: unknown };
if (_g.Buffer == null) {
  _g.Buffer = BufferPolyfill;
}

const JPEG_QUALITY = 80;
const SUBDIR = 'imei-serial-reader';
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const b1 = bytes[i] as number;
    const b2 = bytes[i + 1] as number;
    const b3 = bytes[i + 2] as number;
    out +=
      BASE64_CHARS[b1 >> 2] +
      BASE64_CHARS[((b1 & 0x03) << 4) | (b2 >> 4)] +
      BASE64_CHARS[((b2 & 0x0f) << 2) | (b3 >> 6)] +
      BASE64_CHARS[b3 & 0x3f];
  }
  if (i < len) {
    const b1 = bytes[i] as number;
    if (i + 1 === len) {
      out += BASE64_CHARS[b1 >> 2] + BASE64_CHARS[(b1 & 0x03) << 4] + '==';
    } else {
      const b2 = bytes[i + 1] as number;
      out +=
        BASE64_CHARS[b1 >> 2] +
        BASE64_CHARS[((b1 & 0x03) << 4) | (b2 >> 4)] +
        BASE64_CHARS[(b2 & 0x0f) << 2] +
        '=';
    }
  }
  return out;
}

let subdirEnsured = false;

async function ensureSubdir(): Promise<string> {
  const dir = `${RNFS.CachesDirectoryPath}/${SUBDIR}`;
  if (!subdirEnsured) {
    const exists = await RNFS.exists(dir);
    if (!exists) await RNFS.mkdir(dir);
    subdirEnsured = true;
  }
  return dir;
}

function rgbToRgba(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    out[j] = rgb[i] as number;
    out[j + 1] = rgb[i + 1] as number;
    out[j + 2] = rgb[i + 2] as number;
    out[j + 3] = 255;
  }
  return out;
}

function uuidLike(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function encodeAndWriteJpeg(input: {
  rgb: Uint8Array;
  width: number;
  height: number;
}): Promise<string> {
  const { rgb, width, height } = input;
  const rgba = rgbToRgba(rgb, width, height);
  const encoded = jpegJs.encode({ data: rgba, width, height }, JPEG_QUALITY);
  const base64 = uint8ToBase64(encoded.data);
  const dir = await ensureSubdir();
  const path = `${dir}/${uuidLike()}.jpg`;
  await RNFS.writeFile(path, base64, 'base64');
  return path;
}
