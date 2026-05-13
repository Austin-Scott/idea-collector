type WakeLockType = "screen";

interface WakeLockSentinel extends EventTarget {
  readonly released: boolean;
  readonly type: WakeLockType;
  release(): Promise<void>;
}

interface WakeLockController {
  request(type: WakeLockType): Promise<WakeLockSentinel>;
}

export type WakeLockState = "active" | "released" | "unsupported" | "error";

let sentinel: WakeLockSentinel | null = null;

export function isWakeLockSupported(): boolean {
  return Boolean(getWakeLock());
}

export async function requestScreenWakeLock(onRelease: () => void): Promise<WakeLockState> {
  const wakeLock = getWakeLock();
  if (!wakeLock) {
    return "unsupported";
  }

  try {
    sentinel = await wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
      onRelease();
    });
    return "active";
  } catch {
    sentinel = null;
    return "error";
  }
}

export async function releaseScreenWakeLock(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  await current?.release();
}

export function isFullscreenActive(): boolean {
  return Boolean(document.fullscreenElement);
}

export async function enterFullscreen(): Promise<void> {
  await document.documentElement.requestFullscreen({ navigationUI: "hide" });
}

export async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
}

function getWakeLock(): WakeLockController | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockController }).wakeLock;
}
