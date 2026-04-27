import { describe, expect, it } from "vitest";
import { resolveGenerateConfigOverrides } from "../src/commands/generate.js";
import { createEnvTemplate, inspectConfig } from "../src/lib/config.js";

const baseEnv = {
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  CLOUDFLARE_API_TOKEN: "api-token",
};

describe("config inspection", () => {
  it("warns when hybrid mode has no pexels key", () => {
    const inspection = inspectConfig(baseEnv);

    expect(inspection.errors).toEqual([]);
    expect(inspection.warnings[0]).toContain("PEXELS_API_KEY");
    expect(inspection.config?.visualSourceProfile).toBe("hybrid");
    expect(inspection.config?.availableVisualSources).toEqual(["ai_image"]);
    expect(inspection.config?.captionStyle).toBe("tiktok");
    expect(inspection.config?.captionFontName).toBe("NanumSquareRound");
    expect(inspection.config?.captionOutlineWidth).toBe(7);
    expect(inspection.config?.captionFontSize).toBe(90);
    expect(inspection.config?.captionMaxWords).toBe(3);
    expect(inspection.config?.captionHighlightColor).toBe("green");
    expect(inspection.config?.videoReviewEnabled).toBe(true);
    expect(inspection.config?.videoReviewMaxIterations).toBe(1);
  });

  it("requires pexels in stock-image mode", () => {
    const inspection = inspectConfig({
      ...baseEnv,
      VISUAL_SOURCE_PROFILE: "stock-image",
    });

    expect(inspection.errors[0]).toContain("PEXELS_API_KEY");
  });

  it("creates a profile-specific env template", () => {
    const template = createEnvTemplate("ai-image");

    expect(template).toContain("VISUAL_SOURCE_PROFILE=ai-image");
    expect(template).toContain("CAPTION_STYLE=tiktok");
    expect(template).toContain("VIDEO_REVIEW_ENABLED=true");
    expect(template).toContain("CLOUDFLARE_ACCOUNT_ID=");
  });

  it("treats placeholder credentials as missing", () => {
    const inspection = inspectConfig({
      CLOUDFLARE_ACCOUNT_ID: "your_cloudflare_account_id_here",
      CLOUDFLARE_API_TOKEN: "your_cloudflare_api_token_here",
    });

    expect(inspection.errors).toContain("Missing CLOUDFLARE_ACCOUNT_ID.");
    expect(inspection.errors).toContain("Missing CLOUDFLARE_API_TOKEN.");
  });

  it("rejects unsupported hosted model overrides", () => {
    const inspection = inspectConfig({
      ...baseEnv,
      CLOUDFLARE_KIMI_MODEL: "@cf/example/other-model",
    });

    expect(inspection.errors).toContain("CLOUDFLARE_KIMI_MODEL must be @cf/moonshotai/kimi-k2.6.");
  });
});

describe("generate command options", () => {
  it("maps commander --no-captions output to disabled captions", () => {
    const overrides = resolveGenerateConfigOverrides({ captions: false });

    expect(overrides.captionsEnabled).toBe(false);
  });
});
