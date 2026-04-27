import { config as loadDotEnv } from "dotenv";
import path from "node:path";
import { inspectConfig } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { ensureFfmpegInstalled } from "../lib/render.js";
import { pathExists } from "../lib/utils.js";

export async function runDoctor(): Promise<void> {
  loadDotEnv({ path: path.join(process.cwd(), ".env") });
  await ensureFfmpegInstalled();

  const envExists = await pathExists(path.join(process.cwd(), ".env"));
  const inspection = inspectConfig(process.env);

  console.log(`.env present: ${envExists ? "yes" : "no"}`);

  if (inspection.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of inspection.warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (inspection.errors.length > 0) {
    throw new CliError(`Doctor found configuration problems:\n- ${inspection.errors.join("\n- ")}`);
  }

  console.log("Configuration looks good.");
}
