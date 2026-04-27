# slideshow-cli

`slideshow-cli` generates TikTok-style multiple-image slideshow videos from a prompt using Cloudflare Workers AI, Pexels, and ffmpeg.

## Features

- Kimi 2.6 creates the slideshow plan, visual direction, slide prompts, and review feedback
- MeloTTS synthesizes narration
- Whisper produces word-level timings for subtitle cues
- Pexels and Flux Schnell supply slide imagery
- ffmpeg renders the final MP4 video output and sidecar manifest from multiple still-image slides

## Requirements

- Node.js 20.18 or newer
- ffmpeg and ffprobe on `PATH`
- Cloudflare Workers AI credentials
- Pexels API key when using `hybrid` or `stock-image` visual sourcing

## Use With npx

```bash
npx slideshow-cli init
npx slideshow-cli doctor
npx slideshow-cli generate --template tiktok "three-image TikTok slideshow for a skincare launch"
```

## Install Globally

```bash
npm install -g slideshow-cli
slideshow-cli init
slideshow-cli doctor
slideshow-cli generate "launch teaser for a specialty coffee brand"
```

The package also installs the shorter `slideshow` command:

```bash
slideshow generate --template product "new espresso grinder launch"
```

## Environment

Create a `.env` file in the directory where you run the CLI:

```bash
slideshow-cli init
```

Set these values before generating videos:

```bash
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
PEXELS_API_KEY=your_pexels_api_key
```

The default hosted model settings are:

```bash
CLOUDFLARE_KIMI_MODEL=@cf/moonshotai/kimi-k2.6
CLOUDFLARE_FLUX_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_WHISPER_MODEL=@cf/openai/whisper
CLOUDFLARE_MELOTTS_MODEL=@cf/myshell-ai/melotts
```

`slideshow-cli` validates these model IDs and rejects unsupported model overrides.

## Commands

```bash
slideshow-cli generate <prompt...>   # Generate a slideshow video
slideshow-cli init                   # Write .env and .env.example templates
slideshow-cli doctor                 # Check ffmpeg and configuration
```

Useful `generate` options:

```bash
--output <path>             Output .mp4 path or output directory
--orientation <orientation> portrait or landscape
--template <template>       default, tiktok, dynamic, storytelling, product, or minimal
--reference-image <paths...>
--no-captions
--keep-temp
```

## Visual Source Profiles

`slideshow-cli init --profile <profile>` supports:

- `hybrid`: Kimi chooses between Pexels stock images and Flux AI images per slide
- `stock-image`: use only Pexels stock images
- `ai-image`: use only Flux AI images

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

## License

MIT
