export type Orientation = "portrait" | "landscape";
export type VisualSourceProfile = "hybrid" | "stock-image" | "ai-image";
export type VisualSourceType = "stock_image" | "ai_image";
export type CaptionStyle = "classic" | "tiktok";
export type CaptionPosition =
  | "top"
  | "center"
  | "bottom_center"
  | "bottom_left"
  | "bottom_right";
export type TemplateMotion = "static" | "subtle-in" | "subtle-out";

export interface AppConfig {
  readonly cloudflareAccountId: string;
  readonly cloudflareApiToken: string;
  readonly kimiModel: string;
  readonly fluxModel: string;
  readonly whisperModel: string;
  readonly melottsModel: string;
  readonly melottsLanguage: string;
  readonly kimiThinking: boolean;
  readonly fluxSteps: number;
  readonly pexelsApiKey?: string | undefined;
  readonly visualSourceProfile: VisualSourceProfile;
  readonly availableVisualSources: VisualSourceType[];
  readonly videoReviewEnabled: boolean;
  readonly videoReviewMaxIterations: number;
  readonly orientation: Orientation;
  readonly captionsEnabled: boolean;
  readonly captionStyle: CaptionStyle;
  readonly captionFontName: string;
  readonly captionFontSize: number;
  readonly captionColor: string;
  readonly captionHighlightColor: string;
  readonly captionOutlineColor: string;
  readonly captionOutlineWidth: number;
  readonly captionBold: boolean;
  readonly captionShadowDepth: number;
  readonly captionPosition: CaptionPosition;
  readonly fps: number;
  readonly captionMaxWords: number;
  readonly captionMaxChars: number;
  readonly captionMaxDurationSeconds: number;
}

export interface CaptionWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

export interface CaptionCue {
  readonly cueIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words: readonly CaptionWord[];
}

export interface SlideshowStoryPlan {
  readonly title: string;
  readonly narration: string;
  readonly visualStyle: string;
  readonly publishCaption: string;
  readonly hashtags: string[];
}

export interface SlideBeat {
  readonly cueIndex: number;
  readonly sourceType: VisualSourceType;
  readonly fallbackSourceType?: VisualSourceType | undefined;
  readonly stockQueries: string[];
  readonly fluxPrompt: string;
}

export interface SlideshowReviewResult {
  readonly approved: boolean;
  readonly summary: string;
  readonly issues: string[];
  readonly revisionPrompt: string;
  readonly observedOnScreenText?: string | undefined;
}

export interface SlideshowReviewRecord extends SlideshowReviewResult {
  readonly attempt: number;
  readonly frameCount: number;
}

export interface TemplateConfig {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly promptStyle: string;
  readonly motion: TemplateMotion;
}

export interface GeneratedSlideshowResult {
  readonly outputPath: string;
  readonly manifestPath: string;
  readonly story: SlideshowStoryPlan;
  readonly slideCount: number;
  readonly reviewHistory: readonly SlideshowReviewRecord[];
  readonly workDirectory?: string | undefined;
}
