import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import auth from '../middleware/auth.js';
import Story from '../models/Story.js';
import HeroProfile from '../models/HeroProfile.js';
import Character from '../models/Character.js';
import Episode from '../models/Episode.js';
import { addToQueue } from '../utils/imageQueue.js';
import GenerationStatus from '../models/GenerationStatus.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Ensure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate image using Gemini models via @google/genai SDK (tries multiple models in order)
async function generateImage(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  console.log('[Gemini] Generating image, prompt length:', prompt.length);

  const ai = new GoogleGenAI({ apiKey });

  const modelsToTry = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`[Gemini] Trying model: ${modelName}`);

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseModalities: ['Text', 'Image'],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts;

      if (!parts || parts.length === 0) {
        console.log(`[Gemini] Model ${modelName} returned empty response, trying next...`);
        continue;
      }

      for (const part of parts) {
        if (part.inlineData) {
          console.log(`[Gemini] Success with model: ${modelName}, mime: ${part.inlineData.mimeType}`);
          return {
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          };
        }
      }

      console.log(`[Gemini] Model ${modelName} returned text but no image, trying next...`);
    } catch (err) {
      console.log(`[Gemini] Model ${modelName} failed: ${err.message}`);
      continue;
    }
  }

  throw new Error('All Gemini image models failed — no image generated');
}

// Generate image with character reference images (multimodal input)
async function generateImageWithReferences(textPrompt, referenceImages) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  console.log(`[Gemini] Generating image with ${referenceImages.length} reference(s), prompt length: ${textPrompt.length}`);

  const ai = new GoogleGenAI({ apiKey });

  // Reference images first, then text prompt with strong consistency instruction
  const parts = [];
  for (const ref of referenceImages) {
    parts.push({
      inlineData: {
        mimeType: ref.mimeType || 'image/png',
        data: ref.base64,
      },
    });
  }
  parts.push({
    text: textPrompt + '\nUse EXACTLY the same character appearances as shown in the reference images provided. Do not change faces, skin tone, hairstyle, or clothing style.',
  });

  const modelsToTry = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`[Gemini] Trying model (multimodal): ${modelName}`);

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts }],
        config: {
          responseModalities: ['Text', 'Image'],
        },
      });

      const responseParts = response.candidates?.[0]?.content?.parts;
      if (!responseParts || responseParts.length === 0) {
        console.log(`[Gemini] Model ${modelName} returned empty response, trying next...`);
        continue;
      }

      for (const part of responseParts) {
        if (part.inlineData) {
          console.log(`[Gemini] Success (multimodal) with model: ${modelName}`);
          return {
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          };
        }
      }

      console.log(`[Gemini] Model ${modelName} returned text but no image, trying next...`);
    } catch (err) {
      console.log(`[Gemini] Model ${modelName} failed (multimodal): ${err.message}`);
      continue;
    }
  }

  throw new Error('All Gemini image models failed (multimodal) — no image generated');
}

// Queued wrappers — ensures only one Gemini call at a time across all users
function queuedGenerateImage(prompt) {
  return addToQueue(() => generateImage(prompt));
}

function queuedGenerateImageWithReferences(textPrompt, referenceImages) {
  return addToQueue(() => generateImageWithReferences(textPrompt, referenceImages));
}

// Read a saved image file as base64
function readImageAsBase64(imagePath) {
  const fullPath = path.join(UPLOADS_DIR, '..', imagePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath).toString('base64');
}

// Save base64 image to disk with unique filename, return relative URL
function saveImageToDisk(base64Data, filename) {
  const buffer = Buffer.from(base64Data, 'base64');
  const filePath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${filename}`;
}

// Delete old image file from disk
function deleteImageFile(imagePath) {
  if (!imagePath) return;
  const fullPath = path.join(UPLOADS_DIR, '..', imagePath);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log(`[Cleanup] Deleted old image: ${imagePath}`);
    } catch (err) {
      console.error(`[Cleanup] Failed to delete ${imagePath}:`, err.message);
    }
  }
}

// SSE helper (still used for character/hero cascade which are short-lived)
function sendSSE(res, data) {
  console.log(`[SSE] Sending event: ${data.type}`, data.type === 'error' ? data.message : '');
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Setup SSE headers on a response
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);
  res.flushHeaders();
}

// ─── Generation status tracker (DB-persisted + in-memory cache) ───
const genStatusCache = {};

async function updateGenStatus(storyId, updates) {
  // Update in-memory cache immediately (for fast polling)
  if (!genStatusCache[storyId]) {
    genStatusCache[storyId] = {
      status: 'running', phase: 'Starting...', current: '',
      completed: 0, total: 0, failed: [], error: null,
      startedAt: Date.now(),
    };
  }
  Object.assign(genStatusCache[storyId], updates, { updatedAt: Date.now() });

  // Persist to DB (fire-and-forget for speed, critical fields only)
  try {
    await GenerationStatus.findOneAndUpdate(
      { storyId },
      { ...genStatusCache[storyId], storyId },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('[GenStatus] DB write failed:', err.message);
  }
}

async function getGenStatus(storyId) {
  // Try cache first
  if (genStatusCache[storyId]) return genStatusCache[storyId];
  // Fall back to DB (server may have restarted)
  const doc = await GenerationStatus.findOne({ storyId }).lean();
  if (doc) {
    genStatusCache[storyId] = {
      status: doc.status, phase: doc.phase, current: doc.current,
      completed: doc.completed, total: doc.total, failed: doc.failed,
      error: doc.error, startedAt: doc.startedAt?.getTime(),
    };
    // If it was "running" but startedAt is over 30 min ago, it's stale — mark failed
    if (doc.status === 'running' && doc.startedAt && Date.now() - doc.startedAt.getTime() > 30 * 60 * 1000) {
      genStatusCache[storyId].status = 'failed';
      genStatusCache[storyId].error = 'Generation timed out (server may have restarted)';
      await GenerationStatus.findOneAndUpdate({ storyId }, { status: 'failed', error: genStatusCache[storyId].error });
    }
    return genStatusCache[storyId];
  }
  return null;
}

function cleanupGenStatus(storyId) {
  delete genStatusCache[storyId];
  GenerationStatus.deleteOne({ storyId }).catch(() => {});
}

// Periodic cleanup: remove completed/failed statuses older than 1 hour
setInterval(async () => {
  const oneHourAgo = new Date(Date.now() - 3600000);
  // Clean cache
  for (const sid of Object.keys(genStatusCache)) {
    const s = genStatusCache[sid];
    if (s.status !== 'running' && s.startedAt && s.startedAt < oneHourAgo.getTime()) {
      delete genStatusCache[sid];
    }
  }
  // Clean DB
  try {
    await GenerationStatus.deleteMany({
      status: { $ne: 'running' },
      startedAt: { $lt: oneHourAgo },
    });
  } catch (err) {
    console.error('[GenStatus] Cleanup error:', err.message);
  }
}, 3600000);

// Background image generation function
async function runImageGeneration(storyId) {
  const failed = [];

  try {
    const story = await Story.findById(storyId);
    if (!story) {
      updateGenStatus(storyId, { status: 'failed', error: 'Story not found' });
      return;
    }

    // Update story status to in-progress
    story.status = 'in-progress';
    await story.save();

    const heroProfile = await HeroProfile.findOne({ storyId });
    const characters = await Character.find({ storyId });
    const episodes = await Episode.find({ storyId }).sort({ episodeNumber: 1 });

    const heroCount = heroProfile ? 1 : 0;
    const totalImages = heroCount + characters.length + episodes.length;
    let completed = 0;

    updateGenStatus(storyId, { total: totalImages });

    // --- Phase 0: Hero Image ---
    if (heroProfile) {
      updateGenStatus(storyId, { phase: 'Generating hero image...', current: heroProfile.name });

      try {
        const heroDesc = `${heroProfile.background || ''}. ${heroProfile.personality || ''}`.trim();
        const prompt = `Generate a portrait image of ${heroProfile.name}, the hero of the story. ${heroDesc}. Age: ${heroProfile.age || 'young adult'}. Cinematic lighting, photorealistic, Indian context, professional quality. Movie poster style, detailed face, dramatic background. Portrait orientation.`;

        const imageData = await queuedGenerateImage(prompt);
        const filename = `hero-${storyId}-${Date.now()}.png`;
        deleteImageFile(story.heroImage);
        const imageUrl = saveImageToDisk(imageData.base64, filename);

        await Story.findByIdAndUpdate(storyId, { heroImage: imageUrl });
        completed++;
        updateGenStatus(storyId, { completed });

        await delay(1000);
      } catch (err) {
        console.error(`Failed to generate hero image for ${heroProfile.name}:`, err.message);
        failed.push({ type: 'hero', name: heroProfile.name, error: err.message });
        completed++;
        updateGenStatus(storyId, { completed, failed: [...failed] });
        await delay(1000);
      }
    }

    // --- Phase 1: Character Images ---
    updateGenStatus(storyId, { phase: 'Generating character images...' });

    for (const char of characters) {
      updateGenStatus(storyId, { current: char.name });

      try {
        const prompt = `Generate a portrait image of ${char.name}, ${char.role}, ${char.description}. Cinematic lighting, photorealistic, Indian context, professional quality. Movie poster style, detailed face, dramatic background. Portrait orientation.`;

        const imageData = await queuedGenerateImage(prompt);
        const filename = `character-${char._id}-${Date.now()}.png`;
        deleteImageFile(char.image);
        const imageUrl = saveImageToDisk(imageData.base64, filename);

        await Character.findByIdAndUpdate(char._id, { image: imageUrl });
        completed++;
        updateGenStatus(storyId, { completed });
        await delay(1000);
      } catch (err) {
        console.error(`Failed to generate image for character ${char.name}:`, err.message);
        failed.push({ type: 'character', name: char.name, error: err.message });
        completed++;
        updateGenStatus(storyId, { completed, failed: [...failed] });
        await delay(1000);
      }
    }

    // --- Phase 2: Scene Images ---
    updateGenStatus(storyId, { phase: 'Generating scene images...' });

    // Refresh characters to get saved image URLs
    const updatedChars = await Character.find({ storyId });
    const charInfoMap = {};
    for (const c of updatedChars) {
      charInfoMap[c.name] = {
        desc: `${c.name} (${c.role} - ${c.description})`,
        imagePath: c.image,
      };
    }
    const freshStory = await Story.findById(storyId);

    const heroDesc = heroProfile
      ? `${heroProfile.background || ''}. ${heroProfile.personality || ''}`.trim()
      : '';

    let heroRefB64 = null;
    if (freshStory?.heroImage) {
      heroRefB64 = readImageAsBase64(freshStory.heroImage);
      if (!heroRefB64) console.log('[Scene] Hero image not available, using character only');
    } else {
      console.log('[Scene] Hero image not yet generated, using character only');
    }

    for (const ep of episodes) {
      updateGenStatus(storyId, { current: `Episode ${ep.episodeNumber}: ${ep.title}` });

      try {
        const charInfo = charInfoMap[ep.characterName];
        const charDesc = charInfo?.desc || ep.characterName;
        const isCharHero = heroProfile && ep.characterName === heroProfile.name;

        let prompt;
        if (isCharHero) {
          prompt = `Cinematic scene from Indian story.\nScene: ${ep.sceneDetails}.\nEpisode title: ${ep.title}.\nThe hero ${heroProfile.name} is the focus of this scene: ${heroDesc}.\nUse EXACTLY the appearance from the hero reference image.\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
        } else if (heroProfile) {
          prompt = `Cinematic scene from Indian story.\nScene: ${ep.sceneDetails}.\nEpisode title: ${ep.title}.\nTwo characters are present:\n1. Hero ${heroProfile.name}: ${heroDesc} — use EXACTLY the appearance from hero reference image\n2. ${charDesc} — use EXACTLY the appearance from character reference image\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
        } else {
          prompt = `Cinematic scene from Indian story.\nScene: ${ep.sceneDetails}.\nEpisode title: ${ep.title}.\nCharacter present: ${charDesc}.\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
        }

        const sceneRefs = [];
        if (heroRefB64) {
          sceneRefs.push({ base64: heroRefB64, mimeType: 'image/png' });
        }
        if (!isCharHero && charInfo?.imagePath) {
          const b64 = readImageAsBase64(charInfo.imagePath);
          if (b64) sceneRefs.push({ base64: b64, mimeType: 'image/png' });
        }

        let imageData;
        if (sceneRefs.length > 0) {
          imageData = await queuedGenerateImageWithReferences(prompt, sceneRefs);
        } else {
          imageData = await queuedGenerateImage(prompt);
        }

        const filename = `scene-ep${ep.episodeNumber}-${storyId}-${Date.now()}.png`;
        deleteImageFile(ep.sceneImage);
        const imageUrl = saveImageToDisk(imageData.base64, filename);

        await Episode.findByIdAndUpdate(ep._id, { sceneImage: imageUrl });
        completed++;
        updateGenStatus(storyId, { completed });
        await delay(1000);
      } catch (err) {
        console.error(`Failed to generate scene for ep ${ep.episodeNumber}:`, err.message);
        failed.push({ type: 'scene', episode: ep.episodeNumber, error: err.message });
        completed++;
        updateGenStatus(storyId, { completed, failed: [...failed] });
        await delay(1000);
      }
    }

    // Done
    updateGenStatus(storyId, {
      status: 'complete',
      phase: 'Complete!',
      current: '',
      failed,
    });

    console.log(`[ImageGen] Background generation complete for story ${storyId}. ${completed - failed.length} succeeded, ${failed.length} failed.`);

    // Auto-cleanup cache after 5 minutes (DB cleaned by hourly job)
    setTimeout(() => { delete genStatusCache[storyId]; }, 5 * 60 * 1000);

  } catch (err) {
    console.error('Background image generation error:', err);
    updateGenStatus(storyId, {
      status: 'failed',
      phase: 'Generation failed',
      error: err.message,
    });
    setTimeout(() => { delete genStatusCache[storyId]; }, 5 * 60 * 1000);
  }
}

// POST /api/images/:storyId/generate — Starts background generation
router.post('/:storyId/generate', auth, async (req, res) => {
  const storyId = req.params.storyId;

  try {
    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Check if generation is already running for this story
    const existing = await getGenStatus(storyId);
    if (existing?.status === 'running') {
      return res.status(409).json({ error: 'Image generation already in progress for this story' });
    }

    // Initialize status
    await updateGenStatus(storyId, {
      status: 'running',
      phase: 'Starting...',
      current: '',
      completed: 0,
      total: 0,
      failed: [],
      error: null,
    });

    console.log(`[ImageGen] Starting background generation for story ${storyId}`);

    // Start generation in background — does NOT block the response
    setImmediate(() => runImageGeneration(storyId));

    res.json({ message: 'Generation started', storyId });
  } catch (err) {
    console.error('Start generation error:', err);
    res.status(500).json({ error: 'Failed to start image generation: ' + err.message });
  }
});

// GET /api/images/:storyId/status — Poll generation progress
router.get('/:storyId/status', auth, async (req, res) => {
  const storyId = req.params.storyId;
  const status = await getGenStatus(storyId);

  if (!status) {
    return res.status(404).json({ error: 'No active generation for this story' });
  }

  res.json(status);
});

// POST /api/images/:storyId/main-image — Generate main/cover image with character references
router.post('/:storyId/main-image', auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    const storyId = req.params.storyId;
    const story = await Story.findById(storyId);

    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Fetch all characters + hero for this story
    const characters = await Character.find({ storyId });
    const heroProfile = await HeroProfile.findOne({ storyId });

    // Build character entries with all name variants for matching
    const charEntries = [];
    for (const c of characters) {
      const fullName = c.name.trim();
      const names = [fullName.toLowerCase()];
      // Add each word as a partial name match (e.g. "Arjun" from "Arjun Sharma")
      for (const part of fullName.split(/\s+/)) {
        if (part.length >= 3) names.push(part.toLowerCase());
      }
      charEntries.push({
        names,
        displayName: fullName,
        description: `${c.role} — ${c.description}`,
        imagePath: c.image,
      });
    }
    // Also add hero
    if (heroProfile) {
      const heroName = heroProfile.name.trim();
      const names = [heroName.toLowerCase()];
      for (const part of heroName.split(/\s+/)) {
        if (part.length >= 3) names.push(part.toLowerCase());
      }
      // Also match story.heroName if different
      if (story.heroName && story.heroName.toLowerCase() !== heroName.toLowerCase()) {
        names.push(story.heroName.toLowerCase());
        for (const part of story.heroName.split(/\s+/)) {
          if (part.length >= 3) names.push(part.toLowerCase());
        }
      }
      charEntries.push({
        names,
        displayName: heroName,
        description: `Hero — ${heroProfile.background || ''}. ${heroProfile.personality || ''}`,
        imagePath: story.heroImage,
      });
    }

    // Aggressive matching: split prompt into words, match against all name variants
    const promptLower = prompt.toLowerCase();
    const promptWords = promptLower.split(/\s+/).filter(w => w.length >= 3);
    const matched = new Set();
    const mentionedChars = [];

    for (const entry of charEntries) {
      // Check if any name variant appears in the prompt (full substring match)
      const isFullMatch = entry.names.some((n) => promptLower.includes(n));
      // Check if any prompt word matches a name variant exactly
      const isWordMatch = entry.names.some((n) => promptWords.includes(n));

      if (isFullMatch || isWordMatch) {
        if (!matched.has(entry.displayName)) {
          matched.add(entry.displayName);
          mentionedChars.push(entry);
        }
      }
    }

    console.log('[Cover] Matched characters:', [...matched]);

    // Build reference images and descriptions
    let charDescriptions = '';
    const referenceImages = [];

    // Always include hero reference image first (even if not mentioned in prompt)
    let heroIncluded = false;
    if (story.heroImage) {
      const heroB64 = readImageAsBase64(story.heroImage);
      if (heroB64) {
        referenceImages.push({ base64: heroB64, mimeType: 'image/png' });
        heroIncluded = true;
        console.log('[Cover] Hero reference image always included');
      }
    }
    if (heroProfile && !matched.has(heroProfile.name.trim())) {
      // Hero wasn't matched by name — still add description
      const heroDisplayName = heroProfile.name.trim();
      charDescriptions += `\nCharacter ${heroDisplayName} (Hero): ${heroProfile.background || ''}. ${heroProfile.personality || ''}.`;
      console.log(`[Cover] Hero ${heroDisplayName} added to prompt (not mentioned but always present)`);
    }

    for (const mc of mentionedChars) {
      charDescriptions += `\nCharacter ${mc.displayName}: ${mc.description}.`;

      // Skip loading hero image again if already included
      const isHeroEntry = heroProfile && mc.displayName === heroProfile.name.trim();
      if (isHeroEntry && heroIncluded) {
        console.log(`[Cover] Skipping duplicate hero reference for ${mc.displayName}`);
        continue;
      }

      if (mc.imagePath) {
        const base64 = readImageAsBase64(mc.imagePath);
        if (base64) {
          console.log(`[Cover] Loading reference image: ${mc.imagePath} for ${mc.displayName}`);
          referenceImages.push({ base64, mimeType: 'image/png' });
        } else {
          console.log(`[Cover] Could not load reference image for ${mc.displayName}: ${mc.imagePath}`);
        }
      } else {
        console.log(`[Cover] No image on file for ${mc.displayName}`);
      }
    }

    console.log(`[Cover] ${referenceImages.length} reference image(s) loaded`);

    // Strong consistency prompt when reference images are available
    const consistencyInstruction = referenceImages.length > 0
      ? `\nIMPORTANT: Reference images of the characters are provided. You MUST use EXACTLY the same face, skin tone, hair, and clothing style as shown in the reference images. Do not change any character's appearance. The generated image must look like the same people from the reference images.`
      : '';

    const fullPrompt = `Cover image for Indian story "${story.title}": ${prompt}.${charDescriptions}${consistencyInstruction}
Cinematic, Bollywood movie poster style, dramatic lighting, premium quality, 16:9 aspect ratio.`;

    let imageData;
    if (referenceImages.length > 0) {
      imageData = await queuedGenerateImageWithReferences(fullPrompt, referenceImages);
    } else {
      imageData = await queuedGenerateImage(fullPrompt);
    }

    // Unique filename + delete old
    const filename = `cover-${story._id}-${Date.now()}.png`;
    deleteImageFile(story.mainImage);
    const imageUrl = saveImageToDisk(imageData.base64, filename);

    story.mainImage = imageUrl;
    // Status stays as-is — only user can mark complete
    await story.save();

    res.json({ mainImage: imageUrl, status: story.status });
  } catch (err) {
    console.error('Main image generation error:', err);
    res.status(500).json({ error: 'Failed to generate main image: ' + err.message });
  }
});

// PUT /api/images/:storyId/character/:characterId/image — SSE: Regenerate character + cascade scenes
router.put('/:storyId/character/:characterId/image', auth, async (req, res) => {
  setupSSE(res);

  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) {
      sendSSE(res, { type: 'error', message: 'Story not found' });
      res.end();
      return;
    }
    if (story.creatorId.toString() !== req.user.id) {
      sendSSE(res, { type: 'error', message: 'Only the creator can edit this story' });
      res.end();
      return;
    }

    const { prompt } = req.body;
    if (!prompt) {
      sendSSE(res, { type: 'error', message: 'Prompt is required' });
      res.end();
      return;
    }

    const character = await Character.findOne({ _id: req.params.characterId, storyId: story._id });
    if (!character) {
      sendSSE(res, { type: 'error', message: 'Character not found' });
      res.end();
      return;
    }

    // Phase 1: Generate new character portrait
    sendSSE(res, { type: 'phase', phase: 'character', name: character.name });

    const charPrompt = `Generate a portrait image of ${character.name}, ${character.role}, ${character.description}. User request: ${prompt}. Cinematic lighting, photorealistic, Indian context, professional quality. Movie poster style, detailed face, dramatic background. Portrait orientation 3:4.`;

    const imageData = await queuedGenerateImage(charPrompt);
    // Fix 4: unique filename
    const filename = `character-${character._id}-${Date.now()}.png`;
    deleteImageFile(character.image);
    const newImageUrl = saveImageToDisk(imageData.base64, filename);

    character.image = newImageUrl;
    await character.save();

    sendSSE(res, { type: 'character_image_done', name: character.name, image: newImageUrl });

    // Phase 2: Cascade — regenerate all scene images
    const episodes = await Episode.find({
      storyId: story._id,
      episodeNumber: { $in: character.appearsInEpisodes },
    }).sort({ episodeNumber: 1 });

    const totalScenes = episodes.length;
    sendSSE(res, { type: 'phase', phase: 'scenes', total: totalScenes, completed: 0, name: character.name });

    // Load new character reference image
    const charRefBase64 = readImageAsBase64(newImageUrl);

    // Load hero reference for scenes (hero must appear in every scene)
    const heroProfile = await HeroProfile.findOne({ storyId: story._id });
    const heroDesc = heroProfile
      ? `${heroProfile.background || ''}. ${heroProfile.personality || ''}`.trim()
      : '';
    let heroRefBase64 = null;
    if (story.heroImage) {
      heroRefBase64 = readImageAsBase64(story.heroImage);
      if (!heroRefBase64) console.log('[Scene] Hero image not available for character cascade, using character only');
    } else {
      console.log('[Scene] Hero image not yet generated for character cascade, using character only');
    }

    const updatedScenes = [];
    const failedScenes = [];

    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      sendSSE(res, {
        type: 'scene_progress',
        episodeNumber: ep.episodeNumber,
        current: i + 1,
        total: totalScenes,
        status: 'generating',
      });

      try {
        // Build prompt with hero always present
        let scenePrompt;
        if (heroProfile) {
          scenePrompt = `Cinematic scene from Indian story.\nScene: ${ep.sceneDetails}.\nEpisode title: ${ep.title}.\nTwo characters are present:\n1. Hero ${heroProfile.name}: ${heroDesc} — use EXACTLY the appearance from hero reference image\n2. ${character.name} (${character.role} - ${character.description}) — use EXACTLY the appearance from character reference image\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
        } else {
          scenePrompt = `Cinematic scene from Indian story.\nScene: ${ep.sceneDetails}.\nEpisode title: ${ep.title}.\nCharacter present: ${character.name} (${character.role} - ${character.description}).\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
        }

        // Build reference images: hero + character
        const referenceImages = [];
        if (heroRefBase64) {
          referenceImages.push({ base64: heroRefBase64, mimeType: 'image/png' });
        }
        if (charRefBase64) {
          referenceImages.push({ base64: charRefBase64, mimeType: 'image/png' });
        }

        let sceneData;
        if (referenceImages.length > 0) {
          sceneData = await queuedGenerateImageWithReferences(scenePrompt, referenceImages);
        } else {
          sceneData = await queuedGenerateImage(scenePrompt);
        }

        // Fix 4: unique filename
        const sceneFilename = `scene-ep${ep.episodeNumber}-${story._id}-${Date.now()}.png`;
        deleteImageFile(ep.sceneImage);
        const newSceneUrl = saveImageToDisk(sceneData.base64, sceneFilename);

        ep.sceneImage = newSceneUrl;
        ep.updatedAt = new Date();
        await ep.save();
        updatedScenes.push(ep.episodeNumber);

        sendSSE(res, {
          type: 'scene_progress',
          episodeNumber: ep.episodeNumber,
          current: i + 1,
          total: totalScenes,
          status: 'done',
          image: newSceneUrl,
        });

        await delay(1000); // Rate limit
      } catch (sceneErr) {
        console.error(`Scene regen failed for ep ${ep.episodeNumber}:`, sceneErr.message);
        failedScenes.push(ep.episodeNumber);

        sendSSE(res, {
          type: 'scene_progress',
          episodeNumber: ep.episodeNumber,
          current: i + 1,
          total: totalScenes,
          status: 'failed',
          error: sceneErr.message,
        });

        await delay(1000);
      }
    }

    sendSSE(res, {
      type: 'done',
      characterName: character.name,
      updatedScenes,
      failedScenes,
      totalUpdated: updatedScenes.length,
      totalFailed: failedScenes.length,
    });
  } catch (err) {
    console.error('Character image edit error:', err);
    sendSSE(res, { type: 'error', message: 'Failed to regenerate character image: ' + err.message });
  }

  res.end();
});

// PUT /api/images/:storyId/hero/image — SSE: Regenerate hero image + cascade ALL scenes
router.put('/:storyId/hero/image', auth, async (req, res) => {
  setupSSE(res);

  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) {
      sendSSE(res, { type: 'error', message: 'Story not found' });
      res.end();
      return;
    }
    if (story.creatorId.toString() !== req.user.id) {
      sendSSE(res, { type: 'error', message: 'Only the creator can edit this story' });
      res.end();
      return;
    }

    const { prompt } = req.body;
    if (!prompt) {
      sendSSE(res, { type: 'error', message: 'Prompt is required' });
      res.end();
      return;
    }

    const heroProfile = await HeroProfile.findOne({ storyId: story._id });
    if (!heroProfile) {
      sendSSE(res, { type: 'error', message: 'Hero profile not found' });
      res.end();
      return;
    }

    // Phase 1: Generate new hero portrait
    sendSSE(res, { type: 'phase', phase: 'character', name: heroProfile.name });

    const heroDesc = `${heroProfile.background || ''}. ${heroProfile.personality || ''}`.trim();
    const heroPrompt = `Generate a portrait image of ${heroProfile.name}, the hero. ${heroDesc}. Age: ${heroProfile.age || 'young adult'}. User request: ${prompt}. Cinematic lighting, photorealistic, Indian context, professional quality. Movie poster style, detailed face, dramatic background. Portrait orientation 3:4.`;

    const imageData = await queuedGenerateImage(heroPrompt);
    // Fix 4: unique filename
    const filename = `hero-${story._id}-${Date.now()}.png`;
    deleteImageFile(story.heroImage);
    const newImageUrl = saveImageToDisk(imageData.base64, filename);

    story.heroImage = newImageUrl;
    await story.save();

    sendSSE(res, { type: 'character_image_done', name: heroProfile.name, image: newImageUrl });

    // Phase 2: Cascade — regenerate ALL scene images (hero appears in all episodes)
    const episodes = await Episode.find({ storyId: story._id }).sort({ episodeNumber: 1 });
    const totalScenes = episodes.length;
    sendSSE(res, { type: 'phase', phase: 'scenes', total: totalScenes, completed: 0, name: heroProfile.name });

    // Load new hero reference image
    const heroRefBase64 = readImageAsBase64(newImageUrl);
    const heroRef = heroRefBase64 ? [{ base64: heroRefBase64, mimeType: 'image/png' }] : [];

    const updatedScenes = [];
    const failedScenes = [];

    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];

      sendSSE(res, {
        type: 'scene_progress',
        episodeNumber: ep.episodeNumber,
        current: i + 1,
        total: totalScenes,
        status: 'generating',
      });

      try {
        // Also fetch the episode's own character reference for multimodal (always filter by storyId)
        const epChar = ep.characterId
          ? await Character.findOne({ _id: ep.characterId, storyId: story._id })
          : await Character.findOne({ storyId: story._id, name: ep.characterName });

        const isCharHero = ep.characterName === heroProfile.name;
        const referenceImages = [...heroRef];
        // Only add character ref if it's a different person than the hero
        if (!isCharHero && epChar?.image) {
          const charBase64 = readImageAsBase64(epChar.image);
          if (charBase64) referenceImages.push({ base64: charBase64, mimeType: 'image/png' });
        }

        const charDesc = epChar ? `${epChar.name} (${epChar.role} - ${epChar.description})` : ep.characterName;
        const heroDesc = `${heroProfile.background || ''}. ${heroProfile.personality || ''}`.trim();

        let scenePrompt;
        if (isCharHero) {
          scenePrompt = `Cinematic scene from Indian story.\nScene: ${ep.sceneDetails}.\nEpisode title: ${ep.title}.\nThe hero ${heroProfile.name} is the focus of this scene: ${heroDesc}.\nUse EXACTLY the appearance from the hero reference image.\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
        } else {
          scenePrompt = `Cinematic scene from Indian story.\nScene: ${ep.sceneDetails}.\nEpisode title: ${ep.title}.\nTwo characters are present:\n1. Hero ${heroProfile.name}: ${heroDesc} — use EXACTLY the appearance from hero reference image\n2. ${charDesc} — use EXACTLY the appearance from character reference image\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
        }

        let sceneData;
        if (referenceImages.length > 0) {
          sceneData = await queuedGenerateImageWithReferences(scenePrompt, referenceImages);
        } else {
          sceneData = await queuedGenerateImage(scenePrompt);
        }

        // Fix 4: unique filename
        const sceneFilename = `scene-ep${ep.episodeNumber}-${story._id}-${Date.now()}.png`;
        deleteImageFile(ep.sceneImage);
        const newSceneUrl = saveImageToDisk(sceneData.base64, sceneFilename);

        ep.sceneImage = newSceneUrl;
        ep.updatedAt = new Date();
        await ep.save();
        updatedScenes.push(ep.episodeNumber);

        sendSSE(res, {
          type: 'scene_progress',
          episodeNumber: ep.episodeNumber,
          current: i + 1,
          total: totalScenes,
          status: 'done',
          image: newSceneUrl,
        });

        await delay(1000);
      } catch (sceneErr) {
        console.error(`Scene regen failed for ep ${ep.episodeNumber}:`, sceneErr.message);
        failedScenes.push(ep.episodeNumber);

        sendSSE(res, {
          type: 'scene_progress',
          episodeNumber: ep.episodeNumber,
          current: i + 1,
          total: totalScenes,
          status: 'failed',
          error: sceneErr.message,
        });

        await delay(1000);
      }
    }

    sendSSE(res, {
      type: 'done',
      characterName: heroProfile.name,
      updatedScenes,
      failedScenes,
      totalUpdated: updatedScenes.length,
      totalFailed: failedScenes.length,
    });
  } catch (err) {
    console.error('Hero image edit error:', err);
    sendSSE(res, { type: 'error', message: 'Failed to regenerate hero image: ' + err.message });
  }

  res.end();
});

// PUT /api/images/:storyId/episode/:episodeNumber/scene-image — Regenerate scene image
router.put('/:storyId/episode/:episodeNumber/scene-image', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can edit this story' });
    }

    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const epNumber = parseInt(req.params.episodeNumber);
    const episode = await Episode.findOne({ storyId: story._id, episodeNumber: epNumber });
    if (!episode) return res.status(404).json({ error: 'Episode not found' });

    // Fetch character reference image for consistency (always filter by storyId)
    const character = episode.characterId
      ? await Character.findOne({ _id: episode.characterId, storyId: story._id })
      : await Character.findOne({ storyId: story._id, name: episode.characterName });

    // Fetch hero profile + image (hero must appear in every scene)
    const heroProfile = await HeroProfile.findOne({ storyId: story._id });
    const heroDesc = heroProfile
      ? `${heroProfile.background || ''}. ${heroProfile.personality || ''}`.trim()
      : '';
    const isCharHero = heroProfile && episode.characterName === heroProfile.name;

    const referenceImages = [];
    // Always add hero reference first
    if (story.heroImage) {
      const heroB64 = readImageAsBase64(story.heroImage);
      if (heroB64) {
        referenceImages.push({ base64: heroB64, mimeType: 'image/png' });
      } else {
        console.log('[Scene] Hero image not available for scene regen, using character only');
      }
    } else {
      console.log('[Scene] Hero image not yet generated for scene regen, using character only');
    }
    // Add episode character ref (skip if same as hero)
    if (!isCharHero && character?.image) {
      const base64 = readImageAsBase64(character.image);
      if (base64) referenceImages.push({ base64, mimeType: 'image/png' });
    }

    // Build prompt with hero always present
    let scenePrompt;
    if (isCharHero) {
      scenePrompt = `Cinematic scene from Indian story.\nUser request: ${prompt}.\nScene: ${episode.sceneDetails}.\nEpisode: ${episode.title}.\nThe hero ${heroProfile.name} is the focus of this scene: ${heroDesc}.\nUse EXACTLY the appearance from the hero reference image.\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
    } else if (heroProfile) {
      scenePrompt = `Cinematic scene from Indian story.\nUser request: ${prompt}.\nScene: ${episode.sceneDetails}.\nEpisode: ${episode.title}.\nTwo characters are present:\n1. Hero ${heroProfile.name}: ${heroDesc} — use EXACTLY the appearance from hero reference image\n2. ${episode.characterName} (${character?.role || ''} - ${character?.description || ''}) — use EXACTLY the appearance from character reference image\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
    } else {
      scenePrompt = `Cinematic scene from Indian story.\nUser request: ${prompt}.\nScene: ${episode.sceneDetails}.\nEpisode: ${episode.title}.\nCharacter present: ${episode.characterName} (${character?.role || ''} - ${character?.description || ''}).\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
    }

    let imageData;
    if (referenceImages.length > 0) {
      imageData = await queuedGenerateImageWithReferences(scenePrompt, referenceImages);
    } else {
      imageData = await queuedGenerateImage(scenePrompt);
    }

    // Fix 4: unique filename
    const filename = `scene-ep${epNumber}-${story._id}-${Date.now()}.png`;
    deleteImageFile(episode.sceneImage);
    const newUrl = saveImageToDisk(imageData.base64, filename);

    episode.sceneImage = newUrl;
    episode.updatedAt = new Date();
    await episode.save();

    res.json(episode);
  } catch (err) {
    console.error('Scene image edit error:', err);
    res.status(500).json({ error: 'Failed to regenerate scene image: ' + err.message });
  }
});

export default router;
