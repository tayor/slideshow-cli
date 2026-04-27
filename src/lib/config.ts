import { config as loadDotEnv } from "dotenv";
import path from "node:path";
import { z } from "zod";
import { CliError } from "./errors.js";
import type {
  AppConfig,
  CaptionPosition,
  Orientation,
  VisualSourceProfile,
  VisualSourceType,
} from "./types.js";

const orientationSchema = z.enum(["portrait", "landscape"]);
const visualSourceProfileSchema = z.enum(["hybrid", "stock-image", "ai-image"]);
const captionStyleSchema = z.enum(["classic", "tiktok"]);
const captionPositionSchema = z.enum([
  "top",
  "center",
  "bottom_center",
  "bottom_left",
  "bottom_right",
]);

const hostedModels = {
  kimi: "@cf/moonshotai/kimi-k2.6",
  flux: "@cf/black-forest-labs/flux-1-schnell",
  whisper: "@cf/openai/whisper",
  melotts: "@cf/myshell-ai/melotts",
} as const;

export interface ConfigOverrides {
  readonly orientation?: Orientation | undefined;
  readonly captionsEnabled?: boolean | undefined;
}

export interface ConfigInspection {
  readonly config?: AppConfig | undefined;
  readonly errors: string[];
  readonly warnings: string[];
}

function normalizeConfiguredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "changeme" ||
    normalized.includes("your_cloudflare_") ||
    normalized.includes("your_pexels_") ||
    normalized.includes("placeholder")
  ) {
    return undefined;
  }

  return trimmed;
}

function resolveAvailableVisualSources(
  profile: VisualSourceProfile,
  hasPexels: boolean,
): { availableVisualSources: VisualSourceType[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (profile === "ai-image") {
    return {
      availableVisualSources: ["ai_image"],
      errors,
      warnings,
    };
  }

  if (!hasPexels) {
    if (profile === "hybrid") {
      warnings.push("PEXELS_API_KEY is not set; only ai_image will be available.");
      return {
        availableVisualSources: ["ai_image"],
        errors,
        warnings,
      };
    }

    errors.push(`Missing PEXELS_API_KEY for VISUAL_SOURCE_PROFILE=${profile}.`);
    return {
      availableVisualSources: [],
      errors,
      warnings,
    };
  }

  return {
    availableVisualSources: profile === "stock-image" ? ["stock_image"] : ["stock_image", "ai_image"],
    errors,
    warnings,
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  fieldName: string,
  errors: string[],
  min?: number,
  max?: number,
): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    errors.push(`${fieldName} must be an integer.`);
    return fallback;
  }

  if (min !== undefined && parsed < min) {
    errors.push(`${fieldName} must be >= ${min}.`);
  }
  if (max !== undefined && parsed > max) {
    errors.push(`${fieldName} must be <= ${max}.`);
  }

  return parsed;
}

function parseNumber(
  value: string | undefined,
  fallback: number,
  fieldName: string,
  errors: string[],
  min?: number,
  max?: number,
): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    errors.push(`${fieldName} must be a number.`);
    return fallback;
  }

  if (min !== undefined && parsed < min) {
    errors.push(`${fieldName} must be >= ${min}.`);
  }
  if (max !== undefined && parsed > max) {
    errors.push(`${fieldName} must be <= ${max}.`);
  }

  return parsed;
}

function parseHostedModel(
  value: string | undefined,
  expectedModel: string,
  fieldName: string,
  errors: string[],
): string {
  const model = value?.trim() || expectedModel;
  if (model !== expectedModel) {
    errors.push(`${fieldName} must be ${expectedModel}.`);
  }

  return model;
}

export function inspectConfig(
  env: NodeJS.ProcessEnv,
  overrides: ConfigOverrides = {},
): ConfigInspection {
  const errors: string[] = [];
  const warnings: string[] = [];

  const orientationResult = orientationSchema.safeParse(overrides.orientation ?? env.VIDEO_ORIENTATION ?? "portrait");
  if (!orientationResult.success) {
    errors.push('VIDEO_ORIENTATION must be "portrait" or "landscape".');
  }

  const visualSourceProfileResult = visualSourceProfileSchema.safeParse(env.VISUAL_SOURCE_PROFILE ?? "hybrid");
  if (!visualSourceProfileResult.success) {
    errors.push("VISUAL_SOURCE_PROFILE must be one of: hybrid, stock-image, ai-image.");
  }

  const captionPositionResult = captionPositionSchema.safeParse(env.CAPTION_POSITION ?? "bottom_center");
  if (!captionPositionResult.success) {
    errors.push("CAPTION_POSITION must be one of: top, center, bottom_center, bottom_left, bottom_right.");
  }

  const captionStyleResult = captionStyleSchema.safeParse(env.CAPTION_STYLE ?? "tiktok");
  if (!captionStyleResult.success) {
    errors.push("CAPTION_STYLE must be one of: classic, tiktok.");
  }

  const cloudflareAccountId = normalizeConfiguredValue(env.CLOUDFLARE_ACCOUNT_ID);
  const cloudflareApiToken = normalizeConfiguredValue(env.CLOUDFLARE_API_TOKEN);
  const pexelsApiKey = normalizeConfiguredValue(env.PEXELS_API_KEY);

  if (!cloudflareAccountId) {
    errors.push("Missing CLOUDFLARE_ACCOUNT_ID.");
  }
  if (!cloudflareApiToken) {
    errors.push("Missing CLOUDFLARE_API_TOKEN.");
  }

  const visualSourceProfile = visualSourceProfileResult.success ? visualSourceProfileResult.data : "hybrid";
  const captionStyle = captionStyleResult.success ? captionStyleResult.data : "tiktok";
  const sourceResolution = resolveAvailableVisualSources(visualSourceProfile, Boolean(pexelsApiKey));
  errors.push(...sourceResolution.errors);
  warnings.push(...sourceResolution.warnings);

  const config: AppConfig = {
    cloudflareAccountId: cloudflareAccountId ?? "",
    cloudflareApiToken: cloudflareApiToken ?? "",
    kimiModel: parseHostedModel(env.CLOUDFLARE_KIMI_MODEL, hostedModels.kimi, "CLOUDFLARE_KIMI_MODEL", errors),
    fluxModel: parseHostedModel(env.CLOUDFLARE_FLUX_MODEL, hostedModels.flux, "CLOUDFLARE_FLUX_MODEL", errors),
    whisperModel: parseHostedModel(env.CLOUDFLARE_WHISPER_MODEL, hostedModels.whisper, "CLOUDFLARE_WHISPER_MODEL", errors),
    melottsModel: parseHostedModel(env.CLOUDFLARE_MELOTTS_MODEL, hostedModels.melotts, "CLOUDFLARE_MELOTTS_MODEL", errors),
    melottsLanguage: env.CLOUDFLARE_MELOTTS_LANG ?? "en",
    kimiThinking: parseBoolean(env.CLOUDFLARE_KIMI_THINKING, false),
    fluxSteps: parseInteger(env.CLOUDFLARE_FLUX_STEPS, 4, "CLOUDFLARE_FLUX_STEPS", errors, 1, 8),
    pexelsApiKey: pexelsApiKey ?? undefined,
    visualSourceProfile,
    availableVisualSources: sourceResolution.availableVisualSources,
    videoReviewEnabled: parseBoolean(env.VIDEO_REVIEW_ENABLED, true),
    videoReviewMaxIterations: parseInteger(
      env.VIDEO_REVIEW_MAX_ITERATIONS,
      1,
      "VIDEO_REVIEW_MAX_ITERATIONS",
      errors,
      0,
    ),
    orientation: orientationResult.success ? orientationResult.data : "portrait",
    captionsEnabled: parseBoolean(
      overrides.captionsEnabled === undefined ? env.CAPTIONS_ENABLED : String(overrides.captionsEnabled),
      true,
    ),
    captionStyle,
    captionFontName: env.CAPTION_FONT_FACE ?? (captionStyle === "tiktok" ? "NanumSquareRound" : "Arial"),
    captionFontSize: parseInteger(
      env.CAPTION_FONT_SIZE,
      captionStyle === "tiktok" ? 90 : 64,
      "CAPTION_FONT_SIZE",
      errors,
      12,
    ),
    captionColor: env.CAPTION_FONT_COLOR ?? "white",
    captionHighlightColor:
      env.CAPTION_HIGHLIGHT_COLOR ?? (captionStyle === "tiktok" ? "green" : env.CAPTION_FONT_COLOR ?? "white"),
    captionOutlineColor: env.CAPTION_STROKE_COLOR ?? "black",
    captionOutlineWidth: parseNumber(
      env.CAPTION_STROKE_WIDTH,
      captionStyle === "tiktok" ? 7 : 3,
      "CAPTION_STROKE_WIDTH",
      errors,
      0,
    ),
    captionBold: parseBoolean(env.CAPTION_BOLD, captionStyle === "tiktok"),
    captionShadowDepth: parseNumber(env.CAPTION_SHADOW_DEPTH, 0, "CAPTION_SHADOW_DEPTH", errors, 0),
    captionPosition: (captionPositionResult.success ? captionPositionResult.data : "bottom_center") as CaptionPosition,
    fps: parseInteger(env.VIDEO_FPS, 30, "VIDEO_FPS", errors, 1),
    captionMaxWords: parseInteger(
      env.CAPTION_MAX_WORDS,
      captionStyle === "tiktok" ? 3 : 6,
      "CAPTION_MAX_WORDS",
      errors,
      1,
    ),
    captionMaxChars: parseInteger(env.CAPTION_MAX_CHARS, 28, "CAPTION_MAX_CHARS", errors, 5),
    captionMaxDurationSeconds: parseNumber(
      env.CAPTION_MAX_DURATION_SECONDS,
      4.2,
      "CAPTION_MAX_DURATION_SECONDS",
      errors,
      0.5,
    ),
  };

  return {
    config: errors.length === 0 ? config : undefined,
    errors,
    warnings,
  };
}

export function loadConfig(overrides: ConfigOverrides = {}, cwd = process.cwd()): AppConfig {
  loadDotEnv({ path: path.join(cwd, ".env") });
  const inspection = inspectConfig(process.env, overrides);
  if (inspection.errors.length > 0 || !inspection.config) {
    throw new CliError(
      `Configuration invalid:\n- ${inspection.errors.join("\n- ")}${
        inspection.warnings.length > 0 ? `\n\nWarnings:\n- ${inspection.warnings.join("\n- ")}` : ""
      }`,
    );
  }

  return inspection.config;
}

export function createEnvTemplate(profile: VisualSourceProfile = "hybrid"): string {
  return `# Cloudflare Workers AI account settings
# Create a Workers AI API token and copy your Account ID from:
# https://dash.cloudflare.com/?to=/:account/ai/workers-ai
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here

# Hosted model selections
CLOUDFLARE_KIMI_MODEL=${hostedModels.kimi}
CLOUDFLARE_FLUX_MODEL=${hostedModels.flux}
CLOUDFLARE_WHISPER_MODEL=${hostedModels.whisper}
CLOUDFLARE_MELOTTS_MODEL=${hostedModels.melotts}
CLOUDFLARE_MELOTTS_LANG=en
CLOUDFLARE_KIMI_THINKING=false
CLOUDFLARE_FLUX_STEPS=4

# Visual source profile:
#   hybrid      -> Kimi chooses per slide from stock_image and ai_image
#   stock-image -> Kimi can choose only stock_image
#   ai-image    -> Kimi can choose only ai_image
VISUAL_SOURCE_PROFILE=${profile}
PEXELS_API_KEY=your_pexels_api_key_here

# Review settings
VIDEO_REVIEW_ENABLED=true
VIDEO_REVIEW_MAX_ITERATIONS=1

# Render settings
VIDEO_ORIENTATION=portrait
VIDEO_FPS=30
CAPTIONS_ENABLED=true
CAPTION_STYLE=tiktok
CAPTION_FONT_FACE=NanumSquareRound
CAPTION_FONT_SIZE=90
CAPTION_FONT_COLOR=white
CAPTION_HIGHLIGHT_COLOR=green
CAPTION_STROKE_COLOR=black
CAPTION_STROKE_WIDTH=7
CAPTION_BOLD=true
CAPTION_SHADOW_DEPTH=0
CAPTION_POSITION=bottom_center
CAPTION_MAX_WORDS=3
CAPTION_MAX_CHARS=28
CAPTION_MAX_DURATION_SECONDS=4.2
`;
}
