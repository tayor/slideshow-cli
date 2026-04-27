import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAiClient, buildImageContentPart } from "../src/lib/cloudflare.js";
import { PexelsClient } from "../src/lib/pexels.js";
import type { AppConfig } from "../src/lib/types.js";

const baseConfig: AppConfig = {
  cloudflareAccountId: "account-id",
  cloudflareApiToken: "token",
  kimiModel: "@cf/moonshotai/kimi-k2.6",
  fluxModel: "@cf/black-forest-labs/flux-1-schnell",
  whisperModel: "@cf/openai/whisper",
  melottsModel: "@cf/myshell-ai/melotts",
  melottsLanguage: "en",
  kimiThinking: false,
  fluxSteps: 4,
  pexelsApiKey: "pexels-key",
  visualSourceProfile: "hybrid",
  availableVisualSources: ["stock_image", "ai_image"],
  videoReviewEnabled: true,
  videoReviewMaxIterations: 1,
  orientation: "portrait",
  captionsEnabled: true,
  captionStyle: "tiktok",
  captionFontName: "Arial",
  captionFontSize: 72,
  captionColor: "white",
  captionHighlightColor: "green",
  captionOutlineColor: "black",
  captionOutlineWidth: 3,
  captionBold: true,
  captionShadowDepth: 0,
  captionPosition: "bottom_center",
  fps: 30,
  captionMaxWords: 6,
  captionMaxChars: 28,
  captionMaxDurationSeconds: 4.2,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cloudflare client", () => {
  it("uses the documented ai/run endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            response:
              '{"title":"A title","narration":"A narration","visual_style":"Studio lighting","publish_caption":"Caption","hashtags":["coffee"]}',
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new CloudflareAiClient(baseConfig);
    await client.generateStoryPlan("demo prompt", "default", "clean style", []);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/@cf/moonshotai/kimi-k2.6",
    );
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer token",
    });
  });

  it("builds image_url content parts for Kimi vision messages", () => {
    const part = buildImageContentPart("data:image/png;base64,abc123");

    expect(part).toEqual({
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,abc123",
        detail: "auto",
      },
    });
  });
});

describe("pexels client", () => {
  it("uses the documented authorization header and photo endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          photos: [
            {
              width: 1080,
              height: 1920,
              src: {
                portrait: "https://example.com/file.jpg",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PexelsClient("pexels-key");
    const imageUrl = await client.findBestPhoto("rainy city street", "portrait");

    expect(imageUrl).toBe("https://example.com/file.jpg");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("https://api.pexels.com/v1/search");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "pexels-key",
    });
  });
});
