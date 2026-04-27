import { CliError } from "./errors.js";
import type { Orientation } from "./types.js";

interface PexelsPhoto {
  readonly width?: number;
  readonly height?: number;
  readonly src?: {
    readonly original?: string;
    readonly large2x?: string;
    readonly landscape?: string;
    readonly portrait?: string;
  };
}

function getAspectRatio(orientation: Orientation): number {
  return orientation === "portrait" ? 9 / 16 : 16 / 9;
}

export class PexelsClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(endpoint: string, query: URLSearchParams): Promise<T> {
    const url = `https://api.pexels.com${endpoint}?${query.toString()}`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.apiKey,
      },
    });

    if (!response.ok) {
      const details = await response.text();
      throw new CliError(`Pexels request failed (${response.status}): ${details}`);
    }

    return (await response.json()) as T;
  }

  async findBestPhoto(queryText: string, orientation: Orientation): Promise<string | undefined> {
    const query = new URLSearchParams({
      query: queryText,
      orientation,
      per_page: "12",
    });
    const result = await this.request<{ photos?: PexelsPhoto[] }>("/v1/search", query);
    const targetRatio = getAspectRatio(orientation);

    const ranked = (result.photos ?? [])
      .map((photo) => {
        const width = photo.width ?? 0;
        const height = photo.height ?? 0;
        const ratio = height === 0 ? 0 : width / height;
        const aspectPenalty = Math.abs(ratio - targetRatio);
        const sizeScore = width * height;
        const url =
          (orientation === "portrait" ? photo.src?.portrait : photo.src?.landscape) ??
          photo.src?.large2x ??
          photo.src?.original;

        return {
          url,
          aspectPenalty,
          sizeScore,
        };
      })
      .filter((item) => item.url)
      .sort((left, right) => {
        if (left.aspectPenalty !== right.aspectPenalty) {
          return left.aspectPenalty - right.aspectPenalty;
        }
        return right.sizeScore - left.sizeScore;
      });

    return ranked[0]?.url;
  }
}
