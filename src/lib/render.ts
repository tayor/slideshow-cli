import { spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.js";
import type { Orientation, TemplateMotion } from "./types.js";
import { ensureDir } from "./utils.js";

function getDimensions(orientation: Orientation): { width: number; height: number } {
  return orientation === "portrait"
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
}

async function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new CliError(`Failed to launch ${command}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new CliError(`${command} exited with code ${code}:\n${stderr || stdout}`));
    });
  });
}

function buildVisualFilter(
  orientation: Orientation,
  fps: number,
  motion: TemplateMotion,
  durationSeconds: number,
): string {
  const { width, height } = getDimensions(orientation);
  const frameCount = Math.max(1, Math.round(durationSeconds * fps));
  const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

  if (motion === "static") {
    return `${base},setsar=1,fps=${fps},format=yuv420p`;
  }

  const zoomExpression = motion === "subtle-in"
    ? "if(eq(on,1),1.0,min(zoom+0.0008,1.10))"
    : "if(eq(on,1),1.10,max(zoom-0.0008,1.0))";

  return `${base},zoompan=z='${zoomExpression}':d=${frameCount}:s=${width}x${height}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',setsar=1,fps=${fps},format=yuv420p`;
}

function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

export async function ensureFfmpegInstalled(): Promise<void> {
  try {
    await runCommand("ffmpeg", ["-version"]);
    await runCommand("ffprobe", ["-version"]);
  } catch (error) {
    throw new CliError(
      `ffmpeg and ffprobe are required on PATH.\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function extractReviewFrames(
  videoPath: string,
  framesDirectory: string,
  fps = 1,
  maxFrames = 6,
): Promise<string[]> {
  await ensureDir(framesDirectory);
  const outputPattern = path.join(framesDirectory, "frame-%03d.jpg");
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=${fps},scale=512:-1:force_original_aspect_ratio=decrease`,
    "-q:v",
    "8",
    outputPattern,
  ]);

  const frames = (await readdir(framesDirectory))
    .filter((entry) => entry.endsWith(".jpg"))
    .sort()
    .map((entry) => path.join(framesDirectory, entry));

  if (frames.length === 0) {
    throw new CliError("ffmpeg did not extract any review frames from the rendered video.");
  }

  if (frames.length <= maxFrames) {
    return frames;
  }

  const selectedFrames = new Set<string>();
  for (let index = 0; index < maxFrames; index += 1) {
    const sourceIndex = Math.round((index * (frames.length - 1)) / (maxFrames - 1));
    const frame = frames[sourceIndex];
    if (frame) {
      selectedFrames.add(frame);
    }
  }

  return [...selectedFrames];
}

export async function prepareTranscriptionAudio(inputPath: string, outputPath: string): Promise<void> {
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libopus",
    "-b:a",
    "12k",
    outputPath,
  ]);
}

export async function renderImageSegment(
  inputPath: string,
  outputPath: string,
  durationSeconds: number,
  orientation: Orientation,
  fps: number,
  motion: TemplateMotion,
): Promise<void> {
  await runCommand("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    inputPath,
    "-t",
    durationSeconds.toFixed(3),
    "-vf",
    buildVisualFilter(orientation, fps, motion, durationSeconds),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
}

export async function concatVideoSegments(
  segmentPaths: readonly string[],
  listPath: string,
  outputPath: string,
): Promise<void> {
  const concatList = segmentPaths.map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, `${concatList}\n`, "utf8");

  await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ]);
}

export async function muxNarrationAndSubtitles(
  visualsPath: string,
  audioPath: string,
  outputPath: string,
  subtitlesPath?: string,
): Promise<void> {
  const args = ["-y", "-i", visualsPath, "-i", audioPath];

  if (subtitlesPath) {
    args.push("-vf", `subtitles='${escapeFilterPath(subtitlesPath)}'`);
  }

  args.push(
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  );

  await runCommand("ffmpeg", args);
}
