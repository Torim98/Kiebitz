import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDeviceShake } from "./shake";

/** Ein Bewegungsereignis mit einem Beschleunigungsbetrag entlang x. */
function motion(x: number): Event {
  const event = new Event("devicemotion") as Event & {
    accelerationIncludingGravity?: { x: number; y: number; z: number };
  };
  event.accelerationIncludingGravity = { x, y: 0, z: 0 };
  return event;
}

/**
 * Rucke mit genügend Abstand, damit die Mindestpause dazwischen passt.
 *
 * Gezählt wird die Änderung des Beschleunigungsbetrags · ein Vorzeichenwechsel
 * allein ändert ihn nicht, deshalb springt der Wert zwischen 0 und 30 hin und
 * her. Der Zustand bleibt über Aufrufe hinweg erhalten, damit auch die zweite
 * Schüttelserie eines Tests mit einem echten Sprung beginnt.
 */
let high = false;
function shakeHard(times: number) {
  for (let i = 0; i < times; i++) {
    vi.advanceTimersByTime(150);
    high = !high;
    window.dispatchEvent(motion(high ? 30 : 0));
  }
}

beforeEach(() => {
  high = false;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T10:00:00Z"));
  // jsdom bringt DeviceMotionEvent nicht mit.
  vi.stubGlobal("DeviceMotionEvent", class {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("onDeviceShake", () => {
  it("fires once several jolts have come in quickly", () => {
    const onShake = vi.fn();
    const dispose = onDeviceShake(onShake);

    // Der erste Wert ist nur die Referenz, danach zählen die Sprünge.
    window.dispatchEvent(motion(0));
    shakeHard(3);

    expect(onShake).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("ignores a single jolt", () => {
    const onShake = vi.fn();
    const dispose = onDeviceShake(onShake);

    window.dispatchEvent(motion(0));
    shakeHard(1);

    expect(onShake).not.toHaveBeenCalled();
    dispose();
  });

  it("ignores jolts that are spread out over a long time", () => {
    const onShake = vi.fn();
    const dispose = onDeviceShake(onShake);

    window.dispatchEvent(motion(0));
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(1_600);
      window.dispatchEvent(motion(i % 2 === 0 ? 30 : 0));
    }

    expect(onShake).not.toHaveBeenCalled();
    dispose();
  });

  it("keeps quiet during the cooldown and fires again afterwards", () => {
    const onShake = vi.fn();
    const dispose = onDeviceShake(onShake);

    window.dispatchEvent(motion(0));
    shakeHard(3);
    expect(onShake).toHaveBeenCalledTimes(1);

    shakeHard(3);
    expect(onShake).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4_500);
    shakeHard(3);
    expect(onShake).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("stops listening once disposed", () => {
    const onShake = vi.fn();
    onDeviceShake(onShake)();

    window.dispatchEvent(motion(0));
    shakeHard(4);

    expect(onShake).not.toHaveBeenCalled();
  });

  it("does nothing on a device without motion events", () => {
    vi.stubGlobal("DeviceMotionEvent", undefined);
    const onShake = vi.fn();
    const dispose = onDeviceShake(onShake);

    window.dispatchEvent(motion(0));
    shakeHard(4);

    expect(onShake).not.toHaveBeenCalled();
    dispose();
  });
});
