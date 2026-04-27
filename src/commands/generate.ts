import type { ConfigOverrides } from "../lib/config.js";
import { loadConfig } from "../lib/config.js";
import type { Orientation } from "../lib/types.js";
import { CliError } from "../lib/errors.js";
import { getTemplate } from "../lib/templates.js";
import { generateSlideshow } from "../lib/pipeline.js";

export interface GenerateCommandOptions {
  readonly output?: string;
  readonly orientation?: Orientation;
  readonly referenceImage?: string[];
  readonly captions?: boolean;
  readonly keepTemp?: boolean;
  readonly template?: string;
}

export function resolveGenerateConfigOverrides(options: GenerateCommandOptions): ConfigOverrides {
  return {
    orientation: options.orientation,
    captionsEnabled: options.captions === false ? false : undefined,
  };
}

export async function runGenerate(promptParts: string[], options: GenerateCommandOptions): Promise<void> {
  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    throw new CliError('Provide a prompt, for example: slideshow generate "specialty coffee brand launch"');
  }

  const templateName = options.template ?? "default";
  if (!getTemplate(templateName)) {
    throw new CliError(`Unknown template "${templateName}".`);
  }

  const config = loadConfig(resolveGenerateConfigOverrides(options));

  const result = await generateSlideshow({
    config,
    prompt,
    outputPath: options.output ?? "generated-slideshows",
    templateName,
    referenceImagePaths: options.referenceImage ?? [],
    keepTemp: Boolean(options.keepTemp),
  });

  console.log(`Created ${result.outputPath}`);
  console.log(`Saved manifest ${result.manifestPath}`);
  console.log(`Story title: ${result.story.title}`);
  console.log(`Slides: ${result.slideCount}`);
  const finalReview = result.reviewHistory.at(-1);
  if (finalReview) {
    console.log(`Review: ${finalReview.approved ? "approved" : "not approved"} - ${finalReview.summary}`);
    if (!finalReview.approved && finalReview.issues.length > 0) {
      console.log("Review issues:");
      for (const issue of finalReview.issues) {
        console.log(`- ${issue}`);
      }
    }
  }
  if (result.workDirectory) {
    console.log(`Kept temp work directory ${result.workDirectory}`);
  }
}
