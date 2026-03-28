---
name: video-generation
description: |
  Generate AI videos using Seedance 2.0 (ByteDance/Volcengine) via the Volcengine Ark API.
  Two models: 2.0 (quality) and 2.0 Fast (speed+cost). Max resolution 720p.
  Modes: text-to-video, image-to-video (first frame, first+last frame), multi-modal reference
  (images+videos+audio), video editing, video extension, and web-search-enhanced generation.

  Use when: user asks to generate a video, animate an image, create a video from text/images/audio,
  edit a video with AI, extend a video, create talking-head content, or mentions Seedance/视频生成.
---

# Video Generation — Seedance 2.0

## Setup

- **Default Base URL:** `https://ark.cn-beijing.volces.com`
- **API Key:** From [Volcengine Console](https://console.volcengine.com/ark/region:ark+cn-beijing/apikey)

## Models

| Model | ID | Best For |
|-------|----|----------|
| Seedance 2.0 | `doubao-seedance-2-0-260128` | Maximum quality |
| Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` | Speed + cost (default) |

Both models: max 720p, max 15s, full multi-modal support.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SEEDANCE_API_KEY` | ✅ | — | API key for authentication |
| `SEEDANCE_BASE_URL` | — | `https://ark.cn-beijing.volces.com` | Base URL (override for proxies) |
| `SEEDANCE_MODEL` | — | `doubao-seedance-2-0-fast-260128` | Default model ID |

## Quick Start

### Create Task

```bash
curl -X POST ${SEEDANCE_BASE_URL:-https://ark.cn-beijing.volces.com}/api/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SEEDANCE_API_KEY" \
  -d '{
    "model": "doubao-seedance-2-0-fast-260128",
    "content": [{"type": "text", "text": "A cat playing piano, cinematic lighting"}],
    "resolution": "720p",
    "ratio": "16:9",
    "duration": 5,
    "watermark": false
  }'
```

### Poll Result

```bash
curl ${SEEDANCE_BASE_URL:-https://ark.cn-beijing.volces.com}/api/v3/contents/generations/tasks/{task_id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SEEDANCE_API_KEY"
```

Task is async. Poll until `status == "succeeded"`, then download video URL (valid 24h).

### Response Format

**⚠️ `content` is an object, not an array.** The video URL is at `content.video_url`:

```json
{
  "id": "cgt-...",
  "model": "doubao-seedance-2-0-fast-260128",
  "status": "succeeded",
  "content": {
    "video_url": "https://..."
  },
  "usage": { "completion_tokens": 108900, "total_tokens": 108900 },
  "duration": 5,
  "framespersecond": 24,
  "resolution": "720p",
  "ratio": "16:9"
}
```

## Generation Modes

| Mode | Content Array | Notes |
|------|--------------|-------|
| Text→Video | `[{type:"text", text:"..."}]` | Prompt only |
| First Frame | `[{type:"text",...}, {type:"image_url", image_url:{url:"..."}, role:"first_frame"}]` | |
| First+Last Frame | Two `image_url` with roles `first_frame` + `last_frame` | |
| Multi-modal Reference | Images (`reference_image`) + Videos (`reference_video`) + Audio (`reference_audio`) | Up to 9 images, 3 videos (≤15s total), 3 audio clips |
| Edit Video | Text + reference_image + reference_video | "Replace X in the video with Y from the image" |
| Extend Video | Text + multiple reference_videos | Stitch/extend narrative across clips |

**⚠️ Modes are mutually exclusive:** first_frame/last_frame vs reference_image/reference_video cannot be mixed.

## Key Parameters

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `model` | `doubao-seedance-2-0-260128`, `doubao-seedance-2-0-fast-260128` | fast | Required |
| `resolution` | `480p`, `720p` | `720p` | Max 720p |
| `ratio` | `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `adaptive` | `adaptive` | |
| `duration` | 4–15 (int), or -1 (auto) | 5 | Seconds |
| `generate_audio` | true/false | true | Sync audio/speech/music generation |
| `watermark` | true/false | — | — |
| `tools` | `[{"type":"web_search"}]` | — | Text-to-video only |

## Script

Use `scripts/seedance.sh` for one-shot generation:

```bash
# Text-to-video (default: 2.0 Fast, 720p)
scripts/seedance.sh "A cat playing piano, cinematic lighting"

# Image-to-video (first frame)
scripts/seedance.sh "The character walks forward" --image https://example.com/photo.jpg

# Max quality with 2.0
scripts/seedance.sh "prompt" --model doubao-seedance-2-0-260128 --ratio 9:16 --duration 10

# Download to directory
scripts/seedance.sh "prompt" --download /tmp/videos
```

Respects `SEEDANCE_API_KEY`, `SEEDANCE_BASE_URL`, and `SEEDANCE_MODEL` environment variables.

Features: model validation (rejects non-2.0 models), automatic retry on network errors, human-readable error messages, timeout handling with resume instructions.

## Prompt Tips

- Chinese or English. Keep under 500 Chinese chars / 1000 English words.
- Too much detail → model ignores parts. Focus on key elements.
- For audio generation: put dialogue in double quotes → `男人说："你好"`
- Reference inputs by their order in the content array.

## Detailed API Reference

See `references/volcengine-api.md` for full parameter specs, input constraints, pixel tables, and rate limits.
