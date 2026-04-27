import type { AppConfig, CaptionCue, CaptionWord, Orientation } from "./types.js";

const namedColors: Record<string, string> = {
  white: "#ffffff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  magenta: "#ff00ff",
  black: "#000000",
};

function normalizeHexColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  const named = namedColors[trimmed];
  if (named) {
    return named;
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }

  return "#ffffff";
}

function hexToAssColor(color: string): string {
  const normalized = normalizeHexColor(color).replace("#", "");
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  return `&H00${blue}${green}${red}`.toUpperCase();
}

function sanitizeWord(word: string): string {
  return word.replace(/\s+/g, " ").trim();
}

export function buildCaptionCues(
  words: readonly CaptionWord[],
  config: Pick<AppConfig, "captionMaxChars" | "captionMaxDurationSeconds" | "captionMaxWords">,
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let currentWords: CaptionWord[] = [];
  let cueStart = 0;
  let cueEnd = 0;

  const pushCue = () => {
    if (currentWords.length === 0) {
      return;
    }

    cues.push({
      cueIndex: cues.length,
      start: cueStart,
      end: cueEnd,
      text: currentWords.map((word) => word.word).join(" "),
      words: currentWords,
    });
    currentWords = [];
  };

  for (const rawWord of words) {
    const word = sanitizeWord(rawWord.word);
    if (!word) {
      continue;
    }

    const normalizedWord: CaptionWord = {
      word,
      start: rawWord.start,
      end: Math.max(rawWord.end, rawWord.start + 0.1),
    };

    if (currentWords.length === 0) {
      cueStart = normalizedWord.start;
      cueEnd = normalizedWord.end;
      currentWords = [normalizedWord];
      continue;
    }

    const prospectiveText = [...currentWords.map((currentWord) => currentWord.word), word].join(" ");
    const prospectiveDuration = normalizedWord.end - cueStart;
    const shouldStartNewCue =
      currentWords.length >= config.captionMaxWords ||
      prospectiveText.length > config.captionMaxChars ||
      prospectiveDuration > config.captionMaxDurationSeconds;

    if (shouldStartNewCue) {
      pushCue();
      cueStart = normalizedWord.start;
      cueEnd = normalizedWord.end;
      currentWords = [normalizedWord];
      continue;
    }

    currentWords.push(normalizedWord);
    cueEnd = Math.max(normalizedWord.end, cueEnd);
  }

  pushCue();
  return cues;
}

function formatAssTimestamp(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function getDimensions(orientation: Orientation): { width: number; height: number } {
  return orientation === "portrait"
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
}

function getAlignment(position: AppConfig["captionPosition"]): number {
  switch (position) {
    case "top":
      return 8;
    case "center":
      return 5;
    case "bottom_left":
      return 1;
    case "bottom_right":
      return 3;
    case "bottom_center":
    default:
      return 2;
  }
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function formatDisplayText(text: string, style: AppConfig["captionStyle"]): string {
  return style === "tiktok" ? text.toUpperCase() : text;
}

export function createAssSubtitles(
  cues: readonly CaptionCue[],
  config: Pick<
    AppConfig,
    | "captionBold"
    | "captionColor"
    | "captionFontName"
    | "captionFontSize"
    | "captionHighlightColor"
    | "captionOutlineColor"
    | "captionOutlineWidth"
    | "captionPosition"
    | "captionShadowDepth"
    | "captionStyle"
  >,
  orientation: Orientation,
): string {
  const { width, height } = getDimensions(orientation);
  const fontWeight = config.captionBold ? -1 : 0;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,${config.captionFontName},${config.captionFontSize},${hexToAssColor(config.captionColor)},${hexToAssColor(config.captionHighlightColor)},${hexToAssColor(config.captionOutlineColor)},&H00000000,${fontWeight},0,0,0,100,100,0,0,1,${config.captionOutlineWidth},${config.captionShadowDepth},${getAlignment(config.captionPosition)},60,60,80,1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  const events = cues.map((cue) => {
    const text = escapeAssText(formatDisplayText(cue.text, config.captionStyle));
    return `Dialogue: 0,${formatAssTimestamp(cue.start)},${formatAssTimestamp(cue.end)},Default,,0,0,0,,${text}`;
  });

  return [...header, ...events, ""].join("\n");
}
