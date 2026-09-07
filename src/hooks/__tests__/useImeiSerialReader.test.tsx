/**
 * Pins the arming rules the rest of the pipeline depends on:
 *
 * - a match pauses the native recognizer BEFORE `onDone` runs, so no second
 *   frame is analysed while the consumer handles the first;
 * - `onStarted` must NOT re-arm — VisionCamera 5 fires it on every session
 *   start, and re-arming there delivered a duplicate `onDone`;
 * - the grace window after activation swallows the stale scene;
 * - `reload()` is the way back to scanning.
 *
 * No JSX: the package's tsconfig uses `jsx: 'react-native'` (JSX is preserved,
 * not compiled), so the harness renders through `React.createElement`.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

import { createOcrRecognizer } from '../../native/createOcrRecognizer';
import type { OcrFrame } from '../../specs/OcrRecognizer.nitro';
import { ReaderType } from '../../types';
import {
  useImeiSerialReader,
  type UseImeiSerialReaderOptions,
  type UseImeiSerialReaderReturn,
} from '../useImeiSerialReader';

// React only accepts `act(...)` when it knows it is in a test environment.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-vision-camera', () => ({
  useCameraDevice: () => ({ id: 'back' }),
  useCameraPermission: () => ({ hasPermission: true, requestPermission: () => Promise.resolve(true) }),
}));

jest.mock('../../native/createOcrRecognizer', () => ({ createOcrRecognizer: jest.fn() }));

/** Real IMEI: 15 digits and Luhn-valid, so the real parser accepts it. */
const VALID_IMEI = '490154203237518';
/** Mirrors GRACE_MS in the hook. */
const GRACE_MS = 1000;
/** Mirrors the re-activation delay in `reload()`. */
const RELOAD_DELAY_MS = 50;

const mockCreateOcrRecognizer = createOcrRecognizer as jest.MockedFunction<typeof createOcrRecognizer>;

const ZERO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function frameWithText(text: string): OcrFrame {
  return {
    blocks: [{ text, box: ZERO_BOX, lines: [{ text, box: ZERO_BOX, elements: [{ text, box: ZERO_BOX }] }] }],
    width: 720,
    height: 1280,
    orientation: 'portrait',
  };
}

// `react-test-renderer` logs a deprecation notice on every `create`. It is the
// only renderer this package can use (no react-dom, no react-native jest
// preset), so filter that one line instead of drowning the output in it.
const realConsoleError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
    realConsoleError(...args);
  });
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('useImeiSerialReader', () => {
  let setPaused: jest.Mock;
  let setCropRect: jest.Mock;
  let dispose: jest.Mock;
  /** Feeds a frame in the way the native output does. */
  let emit: (frame: OcrFrame) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    setPaused = jest.fn();
    setCropRect = jest.fn();
    dispose = jest.fn();
    emit = () => {
      throw new Error('no recognizer was created');
    };
    mockCreateOcrRecognizer.mockImplementation((config) => {
      emit = (frame) => config.onTextRecognized(frame);
      return {
        output: { currentResolution: { width: 1280, height: 720 } },
        setCropRect,
        setPaused,
        dispose,
      } as unknown as ReturnType<typeof createOcrRecognizer>;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function mount(overrides?: Partial<UseImeiSerialReaderOptions>) {
    const onDone = jest.fn();
    const options: UseImeiSerialReaderOptions = {
      parserConfig: { readerType: ReaderType.Imei },
      onDone,
      scanRegion: { enabled: false },
      ...overrides,
    };
    const rendered: { value: UseImeiSerialReaderReturn | null } = { value: null };

    function Host() {
      rendered.value = useImeiSerialReader(options);
      return null;
    }

    act(() => {
      create(React.createElement(Host));
    });

    return {
      onDone,
      hook(): UseImeiSerialReaderReturn {
        if (rendered.value == null) throw new Error('hook did not render');
        return rendered.value;
      },
    };
  }

  /** Fake timers also move `Date.now`, which is what the grace window reads. */
  function advancePastGrace() {
    act(() => {
      jest.advanceTimersByTime(GRACE_MS + 1);
    });
  }

  function armCount(): number {
    return setPaused.mock.calls.filter((call) => call[0] === false).length;
  }

  it('reports a matched IMEI and pauses the recognizer before onDone', () => {
    const { onDone } = mount();
    advancePastGrace();

    act(() => {
      emit(frameWithText(VALID_IMEI));
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith([VALID_IMEI], undefined, undefined);

    const pauseIndex = setPaused.mock.calls.findIndex((call) => call[0] === true);
    expect(pauseIndex).toBeGreaterThanOrEqual(0);
    expect(setPaused.mock.invocationCallOrder[pauseIndex]).toBeLessThan(onDone.mock.invocationCallOrder[0]);
  });

  it('ignores further matching frames once a match has been reported', () => {
    const { onDone } = mount();
    advancePastGrace();

    act(() => {
      emit(frameWithText(VALID_IMEI));
      emit(frameWithText(VALID_IMEI));
    });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ignores frames inside the grace window after activation', () => {
    const { onDone } = mount();

    act(() => {
      emit(frameWithText(VALID_IMEI));
    });
    expect(onDone).not.toHaveBeenCalled();

    advancePastGrace();
    act(() => {
      emit(frameWithText(VALID_IMEI));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm when onStarted fires again after a match', () => {
    const { onDone, hook } = mount();
    advancePastGrace();
    act(() => {
      emit(frameWithText(VALID_IMEI));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(armCount()).toBe(1);

    // VisionCamera 5 fires `onStarted` on every session start.
    act(() => {
      hook().onCameraStarted();
    });
    advancePastGrace();
    act(() => {
      emit(frameWithText(VALID_IMEI));
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(armCount()).toBe(1);
  });

  it('re-arms when reload() cycles isActive', () => {
    const { onDone, hook } = mount();
    advancePastGrace();
    act(() => {
      emit(frameWithText(VALID_IMEI));
    });
    expect(onDone).toHaveBeenCalledTimes(1);

    act(() => {
      hook().reload();
    });
    act(() => {
      jest.advanceTimersByTime(RELOAD_DELAY_MS);
    });
    expect(armCount()).toBe(2);

    advancePastGrace();
    act(() => {
      emit(frameWithText(VALID_IMEI));
    });

    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
