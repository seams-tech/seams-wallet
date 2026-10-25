"""Shared input preparation for the historical public-speech benchmark."""
import numpy as np

SAMPLE_RATE = 16000


def speech_crop(samples, seconds):
    count = seconds * SAMPLE_RATE
    start = max(0, (len(samples) - count) // 2)
    samples = samples[start:start + count].astype(np.float32)
    # Preserve the original benchmark's energy trim, not the current Silero capture path.
    frames = samples[:len(samples) // 160 * 160].reshape(-1, 160)
    voiced = np.flatnonzero(np.sqrt(np.mean(frames * frames, axis=1)) >= 0.006)
    if len(voiced) < (200 if seconds == 4 else 100):
        return None
    start = max(0, int(voiced[0]) * 160 - 3200)
    end = min(len(samples), (int(voiced[-1]) + 1) * 160 + 3200)
    return samples[start:end].copy()
