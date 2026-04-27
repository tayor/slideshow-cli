import { copyFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCaptionCues, createAssSubtitles } from "./captions.js";
import { CloudflareAiClient } from "./cloudflare.js";
import { CliError, getErrorMessage } from "./errors.js";
import { PexelsClient } from "./pexels.js";
import {
  concatVideoSegments,
  ensureFfmpegInstalled,
  extractReviewFrames,
  muxNarrationAndSubtitles,
  prepareTranscriptionAudio,
  renderImageSegment,
} from "./render.js";
import { getTemplate } from "./templates.js";
import type {
  AppConfig,
  GeneratedSlideshowResult,
  SlideBeat,
  SlideshowReviewRecord,
  SlideshowReviewResult,
  SlideshowStoryPlan,
  TemplateConfig,
  VisualSourceType,
} from "./types.js";
import { downloadToFile, ensureDir, safeRemoveDirectory, sha1, slugify, writeJsonFile } from "./utils.js";

function isNsfwPromptRejection(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("nsfw");
}

export interface GenerateSlideshowOptions {
  readonly config: AppConfig;
  readonly prompt: string;
  readonly outputPath: string;
  readonly templateName: string;
  readonly referenceImagePaths: readonly string[];
  readonly keepTemp: boolean;
}

async function resolveVisualAsset(
  beat: SlideBeat,
  story: SlideshowStoryPlan,
  config: AppConfig,
  workDirectory: string,
  clients: { cloudflare: CloudflareAiClient; pexels?: PexelsClient | undefined },
  cache: Map<string, string>,
): Promise<string> {
  const sourceOrder = [
    beat.sourceType,
    ...(beat.fallbackSourceType && beat.fallbackSourceType !== beat.sourceType ? [beat.fallbackSourceType] : []),
    ...config.availableVisualSources.filter(
      (sourceType) => sourceType !== beat.sourceType && sourceType !== beat.fallbackSourceType,
    ),
  ];

  let lastError: unknown;

  for (const sourceType of sourceOrder) {
    try {
      if (sourceType === "stock_image") {
        if (!clients.pexels) {
          continue;
        }

        const queryCacheKey = `stock_image:${beat.stockQueries.join("|")}`;
        const cachedAsset = cache.get(queryCacheKey);
        if (cachedAsset) {
          return cachedAsset;
        }

        for (const query of beat.stockQueries) {
          const imageUrl = await clients.pexels.findBestPhoto(query, config.orientation);
          if (!imageUrl) {
            continue;
          }

          const assetPath = path.join(workDirectory, "assets", `${sha1(imageUrl)}.jpg`);
          await ensureDir(path.dirname(assetPath));
          await downloadToFile(imageUrl, assetPath);
          cache.set(queryCacheKey, assetPath);
          return assetPath;
        }
        continue;
      }

      if (sourceType === "ai_image") {
        const fluxCacheKey = `ai_image:${sha1(`${story.visualStyle}:${beat.fluxPrompt}`)}`;
        const cachedFluxAsset = cache.get(fluxCacheKey);
        if (cachedFluxAsset) {
          return cachedFluxAsset;
        }

        const fluxPath = path.join(workDirectory, "assets", `${fluxCacheKey}.jpg`);
        await ensureDir(path.dirname(fluxPath));
        const imagePrompt = `${story.visualStyle}. ${beat.fluxPrompt}. No text, no lettering, no logos, no brand marks, no watermarks.`;
        try {
          await clients.cloudflare.generateImage(imagePrompt, fluxPath);
        } catch (error) {
          if (!isNsfwPromptRejection(error)) {
            throw error;
          }

          const fallbackSubject = beat.stockQueries[0] ?? story.title;
          await clients.cloudflare.generateImage(
            `Safe, non-explicit, family-friendly slideshow still image. ${story.visualStyle}. Subject: ${fallbackSubject}. No people, no skin, no anatomy, no text, no lettering, no logos, no brand marks, no watermarks.`,
            fluxPath,
          );
        }
        cache.set(fluxCacheKey, fluxPath);
        return fluxPath;
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw new CliError(
    `No asset could be resolved for cue ${beat.cueIndex} from the available source order.${
      lastError ? ` Last error: ${getErrorMessage(lastError)}` : ""
    }`,
  );
}

function resolveOutputPath(requestedOutputPath: string, prompt: string): string {
  if (requestedOutputPath.toLowerCase().endsWith(".mp4")) {
    return path.resolve(requestedOutputPath);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(requestedOutputPath, `${slugify(prompt)}-${stamp}.mp4`);
}

function buildReviewerFeedback(review: SlideshowReviewResult): string {
  const issues = review.issues.length > 0 ? review.issues.map((issue) => `- ${issue}`).join("\n") : "- No specific issues listed.";
  return `Summary: ${review.summary}\nIssues:\n${issues}\nRevision prompt: ${review.revisionPrompt}${
    review.observedOnScreenText ? `\nObserved on-screen text: ${review.observedOnScreenText}` : ""
  }`;
}

function ensureTemplate(name: string): TemplateConfig {
  const template = getTemplate(name);
  if (!template) {
    throw new CliError(`Unknown template "${name}".`);
  }

  return template;
}

export async function generateSlideshow(options: GenerateSlideshowOptions): Promise<GeneratedSlideshowResult> {
  await ensureFfmpegInstalled();

  const template = ensureTemplate(options.templateName);
  const cloudflare = new CloudflareAiClient(options.config);
  const pexels = options.config.pexelsApiKey ? new PexelsClient(options.config.pexelsApiKey) : undefined;

  const workDirectory = await mkdtemp(path.join(os.tmpdir(), "slideshow-cli-"));
  const assetCache = new Map<string, string>();

  try {
    const reviewHistory: SlideshowReviewRecord[] = [];
    let reviewerFeedback: string | undefined;
    let finalAttempt:
      | {
          readonly attempt: number;
          readonly outputPath: string;
          readonly story: SlideshowStoryPlan;
          readonly transcriptionText: string;
          readonly cues: ReturnType<typeof buildCaptionCues>;
          readonly slidePlan: SlideBeat[];
        }
      | undefined;

    for (let attempt = 0; attempt <= options.config.videoReviewMaxIterations; attempt += 1) {
      const attemptNumber = attempt + 1;
      const attemptDirectory = path.join(workDirectory, `attempt-${attemptNumber}`);
      const segmentDirectory = path.join(attemptDirectory, "segments");
      await ensureDir(segmentDirectory);

      const story = await cloudflare.generateStoryPlan(
        options.prompt,
        template.name,
        template.promptStyle,
        options.referenceImagePaths,
        reviewerFeedback,
      );

      const narrationPath = path.join(attemptDirectory, "narration.mp3");
      await cloudflare.generateSpeech(story.narration, narrationPath);

      const transcriptionAudioPath = path.join(attemptDirectory, "transcription.ogg");
      await prepareTranscriptionAudio(narrationPath, transcriptionAudioPath);

      const transcription = await cloudflare.transcribe(transcriptionAudioPath);
      const cues = buildCaptionCues(transcription.words, options.config);
      if (cues.length === 0) {
        throw new CliError("Whisper produced no caption cues.");
      }

      const slidePlan = await cloudflare.generateSlidePlan(
        story,
        cues,
        options.config.availableVisualSources as readonly VisualSourceType[],
        options.referenceImagePaths,
        reviewerFeedback,
        options.prompt,
      );

      const segmentPaths: string[] = [];
      for (const beat of slidePlan) {
        const cue = cues[beat.cueIndex];
        if (!cue) {
          throw new CliError(`Slide plan referenced unknown cue_index=${beat.cueIndex}.`);
        }

        const resolvedAssetPath = await resolveVisualAsset(
          beat,
          story,
          options.config,
          workDirectory,
          { cloudflare, pexels },
          assetCache,
        );

        const segmentPath = path.join(segmentDirectory, `${String(cue.cueIndex).padStart(3, "0")}.mp4`);
        await renderImageSegment(
          resolvedAssetPath,
          segmentPath,
          Math.max(0.6, cue.end - cue.start),
          options.config.orientation,
          options.config.fps,
          template.motion,
        );
        segmentPaths.push(segmentPath);
      }

      const visualsPath = path.join(attemptDirectory, "visuals.mp4");
      await concatVideoSegments(segmentPaths, path.join(attemptDirectory, "segments.txt"), visualsPath);

      let subtitlesPath: string | undefined;
      if (options.config.captionsEnabled) {
        subtitlesPath = path.join(attemptDirectory, "captions.ass");
        const subtitles = createAssSubtitles(cues, options.config, options.config.orientation);
        await writeJsonFile(path.join(attemptDirectory, "cues.json"), cues);
        await ensureDir(path.dirname(subtitlesPath));
        await import("node:fs/promises").then(({ writeFile }) => writeFile(subtitlesPath!, subtitles, "utf8"));
      }

      const candidateOutputPath = path.join(attemptDirectory, "candidate.mp4");
      await muxNarrationAndSubtitles(visualsPath, narrationPath, candidateOutputPath, subtitlesPath);

      finalAttempt = {
        attempt: attemptNumber,
        outputPath: candidateOutputPath,
        story,
        transcriptionText: transcription.text,
        cues,
        slidePlan,
      };

      if (!options.config.videoReviewEnabled) {
        break;
      }

      const reviewFrames = await extractReviewFrames(
        candidateOutputPath,
        path.join(attemptDirectory, "review-frames"),
      );
      const review = await cloudflare.reviewSlideshowFrames(reviewFrames, {
        prompt: options.prompt,
        story,
        cues,
        templateName: template.name,
        captionsEnabled: options.config.captionsEnabled,
        reviewerFeedback,
      });
      reviewHistory.push({
        attempt: attemptNumber,
        approved: review.approved,
        summary: review.summary,
        issues: review.issues,
        revisionPrompt: review.revisionPrompt,
        observedOnScreenText: review.observedOnScreenText,
        frameCount: reviewFrames.length,
      });

      if (review.approved || attempt === options.config.videoReviewMaxIterations) {
        break;
      }

      reviewerFeedback = buildReviewerFeedback(review);
    }

    if (!finalAttempt) {
      throw new CliError("Slideshow generation finished without producing a rendered output.");
    }

    const outputPath = resolveOutputPath(options.outputPath, finalAttempt.story.title);
    await ensureDir(path.dirname(outputPath));
    await copyFile(finalAttempt.outputPath, outputPath);

    const manifestPath = outputPath.replace(/\.mp4$/i, ".json");
    await writeJsonFile(manifestPath, {
      prompt: options.prompt,
      template: template.name,
      outputPath,
      story: finalAttempt.story,
      transcriptionText: finalAttempt.transcriptionText,
      cues: finalAttempt.cues,
      slidePlan: finalAttempt.slidePlan,
      visualSourceProfile: options.config.visualSourceProfile,
      availableVisualSources: options.config.availableVisualSources,
      referenceImagePaths: options.referenceImagePaths,
      videoReviewEnabled: options.config.videoReviewEnabled,
      videoReviewMaxIterations: options.config.videoReviewMaxIterations,
      reviewHistory,
    });

    if (!options.keepTemp) {
      await safeRemoveDirectory(workDirectory);
      return {
        outputPath,
        manifestPath,
        story: finalAttempt.story,
        slideCount: finalAttempt.cues.length,
        reviewHistory,
      };
    }

    return {
      outputPath,
      manifestPath,
      story: finalAttempt.story,
      slideCount: finalAttempt.cues.length,
      reviewHistory,
      workDirectory,
    };
  } catch (error) {
    if (!options.keepTemp) {
      await safeRemoveDirectory(workDirectory);
    }
    throw error;
  }
}
