import type { TemplateConfig } from "./types.js";

export const builtInTemplates: TemplateConfig[] = [
  {
    name: "tiktok",
    description: "TikTok-style multiple-image slideshow pacing with bold hooks and social-first framing.",
    category: "social",
    promptStyle: "TikTok image slideshow built from multiple still images, strong hooks, bold framing, social-first contrast, and punchy pacing.",
    motion: "subtle-in",
  },
  {
    name: "default",
    description: "Balanced pacing with clean, direct visuals.",
    category: "general",
    promptStyle: "Polished social-first visuals with a clean, balanced pace.",
    motion: "static",
  },
  {
    name: "dynamic",
    description: "Punchier framing for fast-moving hooks and product reveals.",
    category: "energetic",
    promptStyle: "High-energy, punchy visuals with stronger contrast and momentum.",
    motion: "subtle-in",
  },
  {
    name: "storytelling",
    description: "Warm editorial tone for narrative explainers and lifestyle stories.",
    category: "narrative",
    promptStyle: "Editorial, story-led imagery with cinematic warmth and continuity.",
    motion: "subtle-out",
  },
  {
    name: "product",
    description: "Commercial framing for launches, offers, and product showcases.",
    category: "commercial",
    promptStyle: "Commercial product photography with crisp lighting and strong composition.",
    motion: "subtle-in",
  },
  {
    name: "minimal",
    description: "Restrained composition with lots of breathing room.",
    category: "general",
    promptStyle: "Minimal, uncluttered visuals with negative space and elegant styling.",
    motion: "static",
  },
];

export function getTemplate(name: string): TemplateConfig | undefined {
  return builtInTemplates.find((template) => template.name === name);
}
