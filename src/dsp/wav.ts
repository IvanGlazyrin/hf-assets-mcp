/**
 * Reading and writing audio.
 *
 * WAV is handled natively, in PCM 16 and 32-bit float. Everything else — the
 * OGG, MP3 and FLAC the Hugging Face Spaces hand back — goes through ffmpeg,
 * which keeps the package free of native dependencies.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

export interface Audio {
  /** One Float64Array per channel. */
  channels: Float64Array[];
  sampleRate: number;
}

let ffmpegPath: string | null | undefined;

/** The ffmpeg executable, or null when there is none. */
export function findFfmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && existsSync(fromEnv)) {
    ffmpegPath = fromEnv;
    return ffmpegPath;
  }
  const found = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], {
    encoding: "utf8",
  });
  if (found.status === 0 && found.stdout.trim()) {
    ffmpegPath = found.stdout.split(/\r?\n/)[0].trim();
    return ffmpegPath;
  }
  ffmpegPath = null;
  return ffmpegPath;
}

function decodeWav(buffer: Buffer): Audio {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  const chunks: Buffer[] = [];
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString("ascii", pos, pos + 4);
    const size = buffer.readUInt32LE(pos + 4);
    const body = buffer.subarray(pos + 8, pos + 8 + size);
    if (id === "fmt ") {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === "data") {
      chunks.push(body);
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error("the WAV file has no fmt chunk");
  if (fmt.format !== 1 && fmt.format !== 3 && fmt.format !== 0xfffe) {
    throw new Error(`unsupported WAV format ${fmt.format}`);
  }

  const data = Buffer.concat(chunks);
  const bytesPerSample = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytesPerSample * fmt.channels));
  const channels: Float64Array[] = [];
  for (let c = 0; c < fmt.channels; c++) channels.push(new Float64Array(frames));

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const at = (i * fmt.channels + c) * bytesPerSample;
      let v: number;
      if (fmt.format === 3 && fmt.bits === 32) {
        v = data.readFloatLE(at);
      } else if (fmt.bits === 16) {
        v = data.readInt16LE(at) / 32768;
      } else if (fmt.bits === 24) {
        const b0 = data[at];
        const b1 = data[at + 1];
        const b2 = data[at + 2];
        let raw = (b2 << 16) | (b1 << 8) | b0;
        if (raw & 0x800000) raw |= ~0xffffff;
        v = raw / 8388608;
      } else if (fmt.bits === 32) {
        v = data.readInt32LE(at) / 2147483648;
      } else {
        throw new Error(`unsupported WAV bit depth ${fmt.bits}`);
      }
      channels[c][i] = v;
    }
  }
  return { channels, sampleRate: fmt.sampleRate };
}

/** Write a WAV file as 16-bit PCM, the range clipped to [-1, 1]. */
export function writeWav(path: string, audio: Audio): void {
  const { channels, sampleRate } = audio;
  const n = channels[0].length;
  const channelCount = channels.length;
  const bytesPerSample = 2;
  const dataBytes = n * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channelCount; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      buffer.writeInt16LE(Math.round(v * 32767), at);
      at += 2;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

/** Decode any audio file into float channels. */
export function readAudio(path: string): Audio {
  const ext = extname(path).toLowerCase();
  if (ext === ".wav") return decodeWav(readFileSync(path));

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    throw new Error(
      `cannot read ${ext || "this file"}: ffmpeg is not on PATH. Install it, or set FFMPEG_PATH, ` +
        "or use a .wav file",
    );
  }
  const tmp = join(tmpdir(), `hf-assets-${process.pid}-${Date.now()}.wav`);
  try {
    execFileSync(ffmpeg, ["-v", "error", "-i", path, "-f", "wav", "-acodec", "pcm_s16le", tmp], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return decodeWav(readFileSync(tmp));
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Write any audio file. WAV is native; the rest goes through ffmpeg. */
export function writeAudio(path: string, audio: Audio): void {
  const ext = extname(path).toLowerCase();
  mkdirSync(dirname(path), { recursive: true });
  if (ext === ".wav") {
    writeWav(path, audio);
    return;
  }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    throw new Error(
      `cannot write ${ext}: ffmpeg is not on PATH. Install it, or set FFMPEG_PATH, ` +
        "or write a .wav file",
    );
  }
  execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "wav", "-i", "-", path], {
    input: Buffer.from(encodeWavBuffer(audio)),
    stdio: ["pipe", "ignore", "pipe"],
  });
}

/** The bytes of a WAV file, for piping into another process. */
export function encodeWavBuffer(audio: Audio): Buffer {
  const tmp = join(tmpdir(), `hf-assets-${process.pid}-${Math.round(Math.random() * 1e9)}.wav`);
  try {
    writeWav(tmp, audio);
    return readFileSync(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}
