import { NitroModules } from 'react-native-nitro-modules';
import type { OcrRecognizer } from '../specs/OcrRecognizer.nitro';
import type { OcrRecognizerConfig, OcrRecognizerFactory } from '../specs/OcrRecognizerFactory.nitro';

let factory: OcrRecognizerFactory | undefined;

function getFactory(): OcrRecognizerFactory {
  if (factory == null) {
    factory = NitroModules.createHybridObject<OcrRecognizerFactory>('OcrRecognizerFactory');
  }
  return factory;
}

/** Creates a native OCR camera output. Call `dispose()` on the result when done. */
export function createOcrRecognizer(config: OcrRecognizerConfig): OcrRecognizer {
  return getFactory().createOcrRecognizer(config);
}
