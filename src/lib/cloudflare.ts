import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CliError } from "./errors.js";
import type {
  AppConfig,
  CaptionCue,
  CaptionWord,
  SlideBeat,
  SlideshowReviewResult,
  SlideshowStoryPlan,
  VisualSourceType,
} from "./types.js";
import { fileToDataUrl } from "./utils.js";

const storyPlanSchema = z.object({
  title: z.string().min(1),
  narration: z.string().min(1),
  visual_style: z.string().min(1),
  publish_caption: z.string().min(1),
  hashtags: z.array(z.string().min(1)).min(1).max(8),
});

const slideBeatSchema = z.object({
  cue_index: z.number().int().nonnegative(),
  source_type: z.enum(["stock_image", "ai_image"]),
  fallback_source_type: z.enum(["stock_image", "ai_image"]).optional(),
  stock_queries: z.array(z.string().min(2)).min(1).max(3),
  flux_prompt: z.string().min(8),
});

const slidePlanSchema = z.object({
  beats: z.array(slideBeatSchema),
});

const slideshowReviewSchema = z.object({
  approved: z.boolean(),
  summary: z.string().min(1),
  issues: z.array(z.string().min(1)).max(6),
  revision_prompt: z.string().min(1),
  observed_on_screen_text: z.string().optional(),
});

interface CloudflareEnvelope<TResult> {
  readonly success?: boolean;
  readonly errors?: Array<{ readonly message?: string }>;
  readonly result?: TResult;
}

interface ChatContentImagePart {
  readonly type: "image_url";
  readonly image_url: { readonly url: string; readonly detail: "auto" };
}

export function buildImageContentPart(dataUrl: string): ChatContentImagePart {
  return {
    type: "image_url",
    image_url: {
      url: dataUrl,
      detail: "auto",
    },
  };
}

function normalizeHashtags(hashtags: string[]) {
  return [...new Set(
    hashtags
      .map((tag) => tag.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_-]/gu, "").toLowerCase())
      .filter(Boolean),
  )].map((tag) => `#${tag}`);
}

function extractTextOutput(result: unknown): string {
  if (typeof result === "object" && result !== null) {
    if ("response" in result && typeof result.response === "string") {
      return result.response;
    }

    if ("choices" in result && Array.isArray(result.choices)) {
      const firstChoice = result.choices[0];
      if (
        typeof firstChoice === "object" &&
        firstChoice !== null &&
        "message" in firstChoice &&
        typeof firstChoice.message === "object" &&
        firstChoice.message !== null &&
        "content" in firstChoice.message &&
        typeof firstChoice.message.content === "string"
      ) {
        return firstChoice.message.content;
      }

      if (typeof firstChoice === "object" && firstChoice !== null && "text" in firstChoice && typeof firstChoice.text === "string") {
        return firstChoice.text;
      }
    }
  }

  throw new CliError("Cloudflare Workers AI returned no text response.");
}

async function buildReferenceImageParts(
  referenceImagePaths: readonly string[],
): Promise<Array<{ readonly type: "image_url"; readonly image_url: { readonly url: string; readonly detail: "auto" } }>> {
  const parts = await Promise.all(
    referenceImagePaths.map(async (referenceImagePath) => buildImageContentPart(await fileToDataUrl(referenceImagePath))),
  );
  return parts;
}

export class CloudflareAiClient {
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}`;
  }

  async runModel<TResult>(model: string, input: unknown): Promise<TResult> {
    const response = await fetch(`${this.baseUrl}/ai/run/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.cloudflareApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new CliError(`Cloudflare Workers AI request failed (${response.status}): ${details}`);
    }

    const payload = (await response.json()) as CloudflareEnvelope<TResult>;
    if (payload.success === false || payload.result === undefined) {
      const details =
        payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
        "Cloudflare Workers AI returned no result.";
      throw new CliError(details);
    }

    return payload.result;
  }

  private async requestStructuredOutput<TOutput>(
    promptText: string,
    schemaName: string,
    schema: Record<string, unknown>,
    validator: z.ZodType<TOutput>,
    referenceImagePaths: readonly string[] = [],
  ): Promise<TOutput> {
    const imageParts = await buildReferenceImageParts(referenceImagePaths);
    const userContent =
      imageParts.length === 0
        ? promptText
        : [{ type: "text", text: promptText }, ...imageParts];

    const result = await this.runModel<{ response: string }>(this.config.kimiModel, {
      messages: [
        {
          role: "system",
          content: "Return only valid JSON that matches the provided schema. Do not wrap the JSON in markdown.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          schema,
          strict: true,
        },
      },
      chat_template_kwargs: {
        thinking: this.config.kimiThinking,
      },
      temperature: 0.2,
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractTextOutput(result));
    } catch (error) {
      throw new CliError(
        `Kimi returned invalid JSON for ${schemaName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return validator.parse(parsedJson);
  }

  async generateStoryPlan(
    prompt: string,
    templateName: string,
    templatePromptStyle: string,
    referenceImagePaths: readonly string[],
    reviewerFeedback?: string,
  ): Promise<SlideshowStoryPlan> {
    const reviewerBlock = reviewerFeedback
      ? `\nReviewer feedback from the previous render attempt:\n${reviewerFeedback}\n\nRevise the story plan to address every issue without making the narration bloated.\n`
      : "";

    const response = await this.requestStructuredOutput(
      `Create a short-form slideshow plan for the following prompt.\n\nPrompt: ${prompt}\nTemplate: ${templateName}\nTemplate mood: ${templatePromptStyle}\n${reviewerBlock}\nRequirements:\n- Write a concise spoken narration suitable for one short slideshow video.\n- Keep the narration under 140 words.\n- Start with a strong hook.\n- visual_style should describe the shared look for the slideshow.\n- publish_caption should be one polished social caption.\n- hashtags should be 4-8 short relevant tags without # symbols.\n- Avoid markdown, emojis, citations, or stage directions.\n- If reference images are attached, use them to align the tone, setting, or subject.\n`,
      "slideshow_story_plan",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1 },
          narration: { type: "string", minLength: 1 },
          visual_style: { type: "string", minLength: 1 },
          publish_caption: { type: "string", minLength: 1 },
          hashtags: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            maxItems: 8,
          },
        },
        required: ["title", "narration", "visual_style", "publish_caption", "hashtags"],
      },
      storyPlanSchema,
      referenceImagePaths,
    );

    return {
      title: response.title,
      narration: response.narration,
      visualStyle: response.visual_style,
      publishCaption: response.publish_caption,
      hashtags: normalizeHashtags(response.hashtags),
    };
  }

  async generateSlidePlan(
    story: SlideshowStoryPlan,
    cues: readonly CaptionCue[],
    availableVisualSources: readonly VisualSourceType[],
    referenceImagePaths: readonly string[],
    reviewerFeedback?: string,
    originalPrompt?: string,
  ): Promise<SlideBeat[]> {
    const reviewerBlock = reviewerFeedback
      ? `\nReviewer feedback from the previous render attempt:\n${reviewerFeedback}\n\nAdjust the slide choices to resolve those issues.\n`
      : "";

    const response = await this.requestStructuredOutput(
      `Create one slideshow beat for every caption cue in this narrated slideshow.\n\nOriginal prompt: ${originalPrompt ?? story.title}\nTitle: ${story.title}\nVisual style: ${story.visualStyle}\nNarration: ${story.narration}\nCaption cues: ${JSON.stringify(
        cues.map((cue) => ({
          cue_index: cue.cueIndex,
          start: cue.start,
          end: cue.end,
          text: cue.text,
        })),
      )}\nAvailable source types: ${JSON.stringify(availableVisualSources)}${reviewerBlock}\nRequirements:\n- Return exactly one beat for every cue_index.\n- source_type must be one of the available source types.\n- fallback_source_type is optional, must differ from source_type, and must also be one of the available source types.\n- Preserve the primary subject, product, place, or object category from the original prompt in every beat unless the prompt explicitly asks for a scene change.\n- For product or object-focused prompts, every stock query and flux prompt must include the exact product or object category. Do not switch to unrelated accessories or adjacent products.\n- For product, brand, or object-launch prompts, prefer ai_image when it is available so the hero product can remain consistent and unbranded.\n- Do not illustrate metaphorical verbs or abstract narration literally when doing so would introduce off-topic objects or places.\n- stock_queries must be short English search phrases that work on stock-image search APIs and remain anchored to the primary subject.\n- stock_queries must not include brand names unless the original prompt explicitly includes that brand. Avoid searches likely to return visible competitor logos.\n- flux_prompt should be a rich prompt for a single still image that keeps the same hero subject category.\n- flux_prompt must explicitly avoid logos, lettering, watermarks, and brand marks.\n- Prefer stock_image for broad realistic lifestyle scenes and ai_image for product consistency, stylized scenes, logo-free scenes, or hard-to-find scenes.\n- When reviewer feedback is present and ai_image is available, prefer ai_image for beats that need to correct subject, product, or style mismatches.\n- Never ask for captions, text overlays, watermarks, or logos unless the cue explicitly needs them.\n`,
      "slideshow_visual_plan",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          beats: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                cue_index: { type: "integer", minimum: 0 },
                source_type: { type: "string", enum: availableVisualSources },
                fallback_source_type: { type: "string", enum: availableVisualSources },
                stock_queries: {
                  type: "array",
                  items: { type: "string", minLength: 2 },
                  minItems: 1,
                  maxItems: 3,
                },
                flux_prompt: { type: "string", minLength: 8 },
              },
              required: ["cue_index", "source_type", "stock_queries", "flux_prompt"],
            },
          },
        },
        required: ["beats"],
      },
      slidePlanSchema,
      referenceImagePaths,
    );

    const cueIndexes = new Set(cues.map((cue) => cue.cueIndex));
    const returnedIndexes = new Set(response.beats.map((beat) => beat.cue_index));

    for (const cueIndex of cueIndexes) {
      if (!returnedIndexes.has(cueIndex)) {
        throw new CliError(`Visual plan is missing cue_index=${cueIndex}.`);
      }
    }

    return response.beats
      .sort((left, right) => left.cue_index - right.cue_index)
      .map((beat) => ({
        cueIndex: beat.cue_index,
        sourceType: beat.source_type,
        fallbackSourceType: beat.fallback_source_type,
        stockQueries: beat.stock_queries,
        fluxPrompt: beat.flux_prompt,
      }));
  }

  async reviewSlideshowFrames(
    framePaths: readonly string[],
    input: {
      readonly prompt: string;
      readonly story: SlideshowStoryPlan;
      readonly cues: readonly CaptionCue[];
      readonly templateName: string;
      readonly captionsEnabled: boolean;
      readonly reviewerFeedback?: string | undefined;
    },
  ): Promise<SlideshowReviewResult> {
    const imageParts = await buildReferenceImageParts(framePaths);
    const result = await this.runModel<unknown>(this.config.kimiModel, {
      messages: [
        {
          role: "system",
          content:
            "You are a strict QA reviewer for short-form slideshow videos. Review the visual sequence against the requested brief and respond only with valid JSON matching the provided schema.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Review these sequential frames from a rendered slideshow video.\n\nOriginal prompt: ${input.prompt}\nTemplate: ${input.templateName}\nTitle: ${input.story.title}\nNarration: ${input.story.narration}\nVisual style: ${input.story.visualStyle}\nCaption cues: ${JSON.stringify(
                input.cues.map((cue) => ({
                  cue_index: cue.cueIndex,
                  start: cue.start,
                  end: cue.end,
                  text: cue.text,
                })),
              )}\nCaptions enabled: ${input.captionsEnabled ? "yes" : "no"}\n${
                input.reviewerFeedback
                  ? `Previous reviewer feedback that should already have been addressed: ${input.reviewerFeedback}\n`
                  : ""
              }\nRequirements:\n- These frames are sampled for QA and may not show every caption cue or every scene in the video. Do not report missing captions, missing title cards, or missing scenes solely because they are absent from the sampled frames.\n- approved should be true only if the visible sampled frames clearly match the prompt and narration.\n- If captions are enabled, burned-in subtitle text matching the caption cues is expected and must not be treated as an unwanted text overlay.\n- Do not require title cards, typography overlays, or on-screen marketing copy unless the original prompt explicitly asks for on-screen text.\n- Only flag text embedded in the underlying slide imagery, watermarks, logos, unrelated visible text, or captions that do not match the visible cue context.\n- summary should briefly state whether the render works.\n- issues should list concrete problems, or be [] when approved.\n- revision_prompt should tell the generator exactly what to improve; if approved, say "No changes needed.".\n- observed_on_screen_text should quote notable non-caption text visible in the frames when relevant.\n`,
            },
            ...imageParts,
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "slideshow_review",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              approved: { type: "boolean" },
              summary: { type: "string", minLength: 1 },
              issues: {
                type: "array",
                items: { type: "string", minLength: 1 },
                maxItems: 6,
              },
              revision_prompt: { type: "string", minLength: 1 },
              observed_on_screen_text: { type: "string" },
            },
            required: ["approved", "summary", "issues", "revision_prompt"],
          },
          strict: true,
        },
      },
      temperature: 0,
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractTextOutput(result));
    } catch (error) {
      throw new CliError(
        `Kimi reviewer returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsed = slideshowReviewSchema.parse(parsedJson);
    return {
      approved: parsed.approved,
      summary: parsed.summary,
      issues: parsed.issues,
      revisionPrompt: parsed.revision_prompt,
      observedOnScreenText: parsed.observed_on_screen_text,
    };
  }

  async generateSpeech(audioText: string, outputPath: string): Promise<void> {
    const result = await this.runModel<{ audio: string }>(this.config.melottsModel, {
      prompt: audioText,
      lang: this.config.melottsLanguage,
    });

    await writeFile(outputPath, Buffer.from(result.audio, "base64"));
  }

  async transcribe(audioPath: string): Promise<{ words: CaptionWord[]; text: string; vtt?: string | undefined }> {
    const audio = await readFile(audioPath);
    const result = await this.runModel<{
      text: string;
      vtt?: string;
      words?: Array<{ word?: string; start?: number; end?: number }>;
    }>(this.config.whisperModel, {
      audio: [...audio],
    });

    const words = (result.words ?? [])
      .filter((word): word is { word: string; start: number; end: number } =>
        Boolean(word.word) && typeof word.start === "number" && typeof word.end === "number",
      )
      .map((word) => ({
        word: word.word,
        start: word.start,
        end: word.end,
      }));

    if (words.length === 0) {
      throw new CliError("Whisper returned no word-level timestamps.");
    }

    return {
      words,
      text: result.text,
      vtt: result.vtt,
    };
  }

  async generateImage(prompt: string, outputPath: string): Promise<void> {
    const result = await this.runModel<{ image: string }>(this.config.fluxModel, {
      prompt,
      steps: this.config.fluxSteps,
    });

    await writeFile(outputPath, Buffer.from(result.image, "base64"));
  }
}
