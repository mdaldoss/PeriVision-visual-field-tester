import { LuminanceModel } from "../../../src/core/luminance";
import type { DeviceProfile, SessionConfig } from "../../../src/core/types";

/** A typical 15.6" 1920x1080 laptop. */
export function makeDevice(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  const screenWmm = 344.7;
  const screenHmm = 193.9;
  return {
    id: "test-device",
    screenWmm,
    screenHmm,
    screenWpx: 1920,
    screenHpx: 1080,
    pxPerMm: 1920 / screenWmm,
    gamma: 2.2,
    maxNits: 250,
    userAgent: "test",
    calibratedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeLum(device = makeDevice()): LuminanceModel {
  return new LuminanceModel({ maxNits: device.maxNits, gamma: device.gamma });
}

export function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    eyeOrder: ["OD", "OS"],
    protocol: "threshold",
    gridSpecId: "24-2",
    distanceMm: 330,
    stimulusColor: "white",
    fixationStyle: "dot",
    gazeMonitoring: true,
    age: 45,
    seed: 12345,
    locale: "en",
    debug: false,
    responseFeedback: false,
    ...overrides,
  };
}
