import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
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

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// --- Image generation helpers (shared with images.js logic) ---

function readImageAsBase64(imagePath) {
  const fullPath = path.join(UPLOADS_DIR, '..', imagePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath).toString('base64');
}

function saveImageToDisk(base64Data, filename) {
  const buffer = Buffer.from(base64Data, 'base64');
  const filePath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${filename}`;
}

function deleteImageFile(imagePath) {
  if (!imagePath) return;
  const fullPath = path.join(UPLOADS_DIR, '..', imagePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

async function generateImageWithReferences(textPrompt, referenceImages) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const ai = new GoogleGenAI({ apiKey });
  const parts = [{ text: textPrompt }];
  for (const ref of referenceImages) {
    parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.base64 } });
  }

  const modelsToTry = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'];
  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts }],
        config: { responseModalities: ['Text', 'Image'] },
      });
      const responseParts = response.candidates?.[0]?.content?.parts;
      if (!responseParts || responseParts.length === 0) continue;
      for (const part of responseParts) {
        if (part.inlineData) {
          return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
        }
      }
    } catch (err) {
      console.log(`[Gemini] Model ${modelName} failed: ${err.message}`);
      continue;
    }
  }
  throw new Error('All Gemini image models failed');
}

async function generateImage(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey });
  const modelsToTry = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'];
  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: { responseModalities: ['Text', 'Image'] },
      });
      const parts = response.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) continue;
      for (const part of parts) {
        if (part.inlineData) {
          return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
        }
      }
    } catch (err) {
      console.log(`[Gemini] Model ${modelName} failed: ${err.message}`);
      continue;
    }
  }
  throw new Error('All Gemini image models failed');
}

const SYSTEM_PROMPT = `You are an AI story generator for the Dailog app.
Generate a complete story arc following the dailog-episode-generator skill format EXACTLY.

Output must include:
1. HERO PROFILE section with all fields
2. 20-25 EPISODES each with:
   - Episode number and title
   - AI Character name and role
   - Scene Details (3-5 lines Hinglish)
   - Production Notes
3. USER ROLE (2 lines max)
4. TRANSITION MESSAGE (1-2 lines max)
5. FIRST MESSAGE (1 line, strong hook)

Language: Always Hinglish
Audience: Tier 2/3 India
Format: Exactly like ChhotiBahu reference

IMPORTANT FORMATTING RULES:
- Do NOT use markdown bold (**) or italics (*) anywhere in your response
- Do NOT use asterisks around field names
- Use plain text only for field labels
- Correct format: Name: Vikrant Malhotra
- Wrong format: **Name:** Vikrant Malhotra
- Wrong format: *Name:* Vikrant Malhotra

HERO NAME RULES:
- Generate a unique Indian name that fits the story theme and setting
- Name must be culturally appropriate for the story
- NEVER use generic placeholder names
- NEVER repeat names from previous stories — every story must have a fresh, unique hero name

IMPORTANT: Output in this EXACT structured format (plain text, no markdown):

---TITLE---
[A catchy 2-word title in ALL CAPS, e.g. VISA VOWS, DESI DREAMS]

---HERO PROFILE---
Name: [hero name - unique Indian name fitting the story]
Age: [age]
Background: [background]
Family: [family details]
Personality: [personality traits]
Weakness: [weakness]
Strength: [strength]
Current Situation: [situation]
Goal: [goal]

---EPISODES---
EPISODE 1: [Title]
Character: [Character Name] | [Role]
Scene Details: [3-5 lines in Hinglish]
Production Notes: [notes]

EPISODE 2: [Title]
...continue for 20-25 episodes...

---USER ROLE---
[2 lines max describing user's role]

---TRANSITION MESSAGE---
[1-2 lines transition message]

---FIRST MESSAGE---
[1 line strong hook opening message]`;

// Parse Claude's response into structured data
function parseStoryResponse(text) {
  // Pre-process: strip all markdown bold/italic from the entire text
  const cleanText = text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');

  const result = {
    title: '',
    heroProfile: {},
    episodes: [],
    characters: [],
    userRole: '',
    transitionMessage: '',
    firstMessage: '',
  };

  // Parse Title — handle markdown in section header too
  const titleMatch = cleanText.match(/---\s*TITLE\s*---\s*([\s\S]*?)(?=---\s*HERO PROFILE\s*---|$)/i);
  if (titleMatch) {
    // Strip any remaining markdown/asterisks and take the first non-empty line
    const rawTitle = titleMatch[1].trim();
    const titleLine = rawTitle.split('\n').map(l => l.trim()).find(l => l.length > 0) || rawTitle;
    result.title = titleLine.toUpperCase();
    console.log('[Parser] Parsed title:', result.title);
  }

  // Parse Hero Profile
  const heroMatch = cleanText.match(/---\s*HERO PROFILE\s*---\s*([\s\S]*?)(?=---\s*EPISODES\s*---|$)/i);
  if (heroMatch) {
    const heroText = heroMatch[1].trim();
    console.log('[Parser] Raw hero section:', heroText.substring(0, 400));

    // Field definitions: [label variants] → result key
    const fieldDefs = [
      { labels: ['Name', 'Naam'], key: 'name' },
      { labels: ['Age', 'Umar'], key: 'age' },
      { labels: ['Background'], key: 'background' },
      { labels: ['Family', 'Parivaar'], key: 'family' },
      { labels: ['Personality'], key: 'personality' },
      { labels: ['Weakness', 'Kamzori'], key: 'weakness' },
      { labels: ['Strength', 'Taakat'], key: 'strength' },
      { labels: ['Current Situation'], key: 'currentSituation' },
      { labels: ['Goal', 'Lakshya'], key: 'goal' },
    ];

    // Build list of all possible label patterns for the lookahead
    const allLabels = fieldDefs.flatMap(f => f.labels);
    const lookaheadPattern = allLabels.join('|');

    for (const def of fieldDefs) {
      if (result.heroProfile[def.key]) continue; // already parsed

      for (const label of def.labels) {
        // Match: label (with optional markdown already stripped) + colon + value
        // Value ends at the next field label or end of section
        const regex = new RegExp(
          `(?:^|\\n)\\s*${label}\\s*:\\s*(.+?)(?=\\n\\s*(?:${lookaheadPattern})\\s*:|$)`,
          'is'
        );
        const match = heroText.match(regex);
        if (match) {
          result.heroProfile[def.key] = match[1].trim();
          break; // first label variant wins
        }
      }
    }

    console.log('[Parser] Parsed hero name:', result.heroProfile.name || '(empty)');
    if (!result.heroProfile.name) {
      console.warn('[Parser] WARNING: Hero name could not be parsed from hero section');
    }
  } else {
    console.warn('[Parser] WARNING: Could not find ---HERO PROFILE--- section at all');
  }

  // Parse Episodes
  const episodesMatch = cleanText.match(/---\s*EPISODES\s*---\s*([\s\S]*?)(?=---\s*USER ROLE\s*---|$)/i);
  if (episodesMatch) {
    const episodesText = episodesMatch[1].trim();
    const episodeBlocks = episodesText.split(/EPISODE\s+(\d+)\s*:/i).filter(Boolean);

    for (let i = 0; i < episodeBlocks.length - 1; i += 2) {
      const num = parseInt(episodeBlocks[i]);
      const block = episodeBlocks[i + 1];

      const epTitleMatch = block.match(/^(.+?)(?=\n)/);
      const charMatch = block.match(/Character\s*:\s*(.+?)\s*\|\s*(.+?)(?=\n)/i);
      const sceneMatch = block.match(/Scene\s*Details\s*:\s*([\s\S]*?)(?=Production\s*Notes\s*:|EPISODE\s+\d+\s*:|$)/i);
      const notesMatch = block.match(/Production\s*Notes\s*:\s*([\s\S]*?)(?=EPISODE\s+\d+\s*:|$)/i);

      const charName = charMatch ? charMatch[1].trim() : '';
      const charRole = charMatch ? charMatch[2].trim() : '';

      // Track unique characters
      if (charName && !result.characters.find((c) => c.name === charName)) {
        result.characters.push({
          name: charName,
          role: charRole,
          description: charRole,
          appearsInEpisodes: [num],
        });
      } else if (charName) {
        const existing = result.characters.find((c) => c.name === charName);
        if (existing && !existing.appearsInEpisodes.includes(num)) {
          existing.appearsInEpisodes.push(num);
        }
      }

      result.episodes.push({
        episodeNumber: num,
        title: epTitleMatch ? epTitleMatch[1].trim() : `Episode ${num}`,
        characterName: charName,
        characterRole: charRole,
        sceneDetails: sceneMatch ? sceneMatch[1].trim() : '',
        productionNotes: notesMatch ? notesMatch[1].trim() : '',
      });
    }
  }

  // Parse User Role
  const userRoleMatch = cleanText.match(/---\s*USER ROLE\s*---\s*([\s\S]*?)(?=---\s*TRANSITION MESSAGE\s*---|$)/i);
  if (userRoleMatch) {
    result.userRole = userRoleMatch[1].trim();
  }

  // Parse Transition Message
  const transitionMatch = cleanText.match(/---\s*TRANSITION MESSAGE\s*---\s*([\s\S]*?)(?=---\s*FIRST MESSAGE\s*---|$)/i);
  if (transitionMatch) {
    result.transitionMessage = transitionMatch[1].trim();
  }

  // Parse First Message
  const firstMsgMatch = cleanText.match(/---\s*FIRST MESSAGE\s*---\s*([\s\S]*?)$/i);
  if (firstMsgMatch) {
    result.firstMessage = firstMsgMatch[1].trim();
  }

  return result;
}

// POST /api/stories/generate
router.post('/generate', auth, async (req, res) => {
  try {
    const { prompt, userCharacter, title } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Call Claude API
    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const userPrompt = `Create a complete interactive story arc based on this concept:

Story Concept: ${prompt}
User Character Role: ${userCharacter || 'Not specified - choose an interesting role for the user'}
${title ? `Preferred Title: ${title}` : 'Generate a catchy 2-word CAPS title for this story.'}

Generate the full story now.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;
    console.log('[Parser] Raw Claude response first 500 chars:', responseText.substring(0, 500));

    const parsed = parseStoryResponse(responseText);

    // Title priority: user-provided > parsed from Claude > fallback
    const storyTitle = title
      || parsed.title
      || 'UNTITLED STORY';

    console.log('[Story] Generated title:', storyTitle);
    console.log('[Story] Hero name parsed:', parsed.heroProfile.name || '(empty)');
    console.log('[Story] All parsed hero fields:', JSON.stringify(parsed.heroProfile));

    // Save Story
    const story = await Story.create({
      title: storyTitle,
      status: 'draft',
      creatorId: req.user.id,
      creatorName: req.user.name,
      prompt,
      userCharacter: userCharacter || '',
      heroName: parsed.heroProfile.name || '',
      userRole: parsed.userRole,
      transitionMessage: parsed.transitionMessage,
      firstMessage: parsed.firstMessage,
    });

    console.log('[Story] Story ID:', story._id);

    // Save Hero Profile
    const heroProfile = await HeroProfile.create({
      storyId: story._id,
      ...parsed.heroProfile,
    });

    // Save Characters
    const characterDocs = await Character.insertMany(
      parsed.characters.map((c) => ({
        storyId: story._id,
        name: c.name,
        role: c.role,
        description: c.description,
        appearsInEpisodes: c.appearsInEpisodes,
      }))
    );

    console.log('[Story] Characters:', characterDocs.map(c => c.name));

    // Build character name -> id map
    const charMap = {};
    for (const doc of characterDocs) {
      charMap[doc.name] = doc._id;
    }

    // Save Episodes
    const episodes = await Episode.insertMany(
      parsed.episodes.map((ep) => ({
        storyId: story._id,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        characterId: charMap[ep.characterName] || null,
        characterName: ep.characterName,
        sceneDetails: ep.sceneDetails,
        productionNotes: ep.productionNotes,
        lastEditedBy: req.user.id,
      }))
    );

    res.status(201).json({
      story,
      heroProfile,
      characters: characterDocs,
      episodes,
    });
  } catch (err) {
    console.error('Story generation error:', err);
    res.status(500).json({ error: 'Failed to generate story: ' + err.message });
  }
});

// GET /api/stories
router.get('/', auth, async (req, res) => {
  try {
    const stories = await Story.find()
      .sort({ createdAt: -1 })
      .select('title mainImage status creatorId creatorName createdAt');
    res.json(stories);
  } catch (err) {
    console.error('Fetch stories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/stories/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const heroProfile = await HeroProfile.findOne({ storyId: story._id });
    const characters = await Character.find({ storyId: story._id });
    const episodes = await Episode.find({ storyId: story._id }).sort({ episodeNumber: 1 });

    // Build hero as a character-like object and prepend to the list
    let allCharacters = [...characters];
    if (heroProfile) {
      const allEpisodeNumbers = episodes.map((e) => e.episodeNumber);
      allCharacters.unshift({
        _id: `hero_${heroProfile._id}`,
        storyId: story._id,
        name: heroProfile.name,
        role: `Hero — ${story.userCharacter || 'Protagonist'}`,
        description: `${heroProfile.background || ''}. ${heroProfile.personality || ''}`.trim(),
        image: story.heroImage || null,
        appearsInEpisodes: allEpisodeNumbers,
        isHero: true,
      });
    }

    res.json({ story, heroProfile, characters: allCharacters, episodes });
  } catch (err) {
    console.error('Fetch story error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/stories/:id/episode/:episodeNumber
router.put('/:id/episode/:episodeNumber', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can edit this story' });
    }

    const { sceneDetails, productionNotes } = req.body;
    const epNumber = parseInt(req.params.episodeNumber);

    const episode = await Episode.findOne({ storyId: story._id, episodeNumber: epNumber });
    if (!episode) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    // Update text fields
    if (sceneDetails !== undefined) episode.sceneDetails = sceneDetails;
    if (productionNotes !== undefined) episode.productionNotes = productionNotes;
    episode.lastEditedBy = req.user.id;
    episode.updatedAt = new Date();

    // Regenerate scene image with hero + character reference
    const oldSceneImage = episode.sceneImage;
    try {
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
          console.log('[Scene] Hero image not available for episode edit regen, using character only');
        }
      } else {
        console.log('[Scene] Hero image not yet generated for episode edit regen, using character only');
      }
      // Add episode character ref (skip if same as hero)
      if (!isCharHero && character?.image) {
        const base64 = readImageAsBase64(character.image);
        if (base64) referenceImages.push({ base64, mimeType: 'image/png' });
      }

      // Build prompt with hero always present
      let scenePrompt;
      if (isCharHero) {
        scenePrompt = `Cinematic scene from Indian story.\nScene: ${episode.sceneDetails}.\nEpisode title: ${episode.title}.\nThe hero ${heroProfile.name} is the focus of this scene: ${heroDesc}.\nUse EXACTLY the appearance from the hero reference image.\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
      } else if (heroProfile) {
        scenePrompt = `Cinematic scene from Indian story.\nScene: ${episode.sceneDetails}.\nEpisode title: ${episode.title}.\nTwo characters are present:\n1. Hero ${heroProfile.name}: ${heroDesc} — use EXACTLY the appearance from hero reference image\n2. ${episode.characterName} (${character?.role || ''} - ${character?.description || ''}) — use EXACTLY the appearance from character reference image\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
      } else {
        scenePrompt = `Cinematic scene from Indian story.\nScene: ${episode.sceneDetails}.\nEpisode title: ${episode.title}.\nCharacter present: ${episode.characterName} (${character?.role || ''} - ${character?.description || ''}).\nBollywood style, warm dramatic lighting, wide shot, detailed background, professional film quality. Landscape orientation 16:9.`;
      }

      let imageData;
      if (referenceImages.length > 0) {
        imageData = await addToQueue(() => generateImageWithReferences(scenePrompt, referenceImages));
      } else {
        imageData = await addToQueue(() => generateImage(scenePrompt));
      }

      // Fix 4: unique filename + delete old first
      const filename = `scene-ep${epNumber}-${story._id}-${Date.now()}.png`;
      deleteImageFile(oldSceneImage);
      episode.sceneImage = saveImageToDisk(imageData.base64, filename);
    } catch (imgErr) {
      console.error(`Scene image regen failed for ep ${epNumber}:`, imgErr.message);
      // Keep text changes even if image fails
      episode.sceneImage = oldSceneImage;
    }

    await episode.save();
    res.json(episode);
  } catch (err) {
    console.error('Update episode error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// POST /api/stories/:id/regenerate — Regenerate full story with Claude
router.post('/:id/regenerate', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can regenerate this story' });
    }

    // Call Claude API with original prompt
    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const userPrompt = `Create a complete interactive story arc based on this concept:

Story Concept: ${story.prompt}
User Character Role: ${story.userCharacter || 'Not specified - choose an interesting role for the user'}
Preferred Title: ${story.title}

Generate the full story now.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;
    const parsed = parseStoryResponse(responseText);

    // Delete old images from disk
    const oldEpisodes = await Episode.find({ storyId: story._id });
    const oldCharacters = await Character.find({ storyId: story._id });
    for (const ep of oldEpisodes) deleteImageFile(ep.sceneImage);
    for (const ch of oldCharacters) deleteImageFile(ch.image);
    deleteImageFile(story.heroImage);
    deleteImageFile(story.mainImage);

    // Clear old data
    await Promise.all([
      Episode.deleteMany({ storyId: story._id }),
      Character.deleteMany({ storyId: story._id }),
      HeroProfile.deleteOne({ storyId: story._id }),
    ]);

    // Update story
    story.heroName = parsed.heroProfile.name || '';
    story.userRole = parsed.userRole;
    story.transitionMessage = parsed.transitionMessage;
    story.firstMessage = parsed.firstMessage;
    story.heroImage = null;
    story.mainImage = null;
    story.status = 'draft';
    await story.save();

    // Save new Hero Profile
    const heroProfile = await HeroProfile.create({
      storyId: story._id,
      ...parsed.heroProfile,
    });

    // Save new Characters
    const characterDocs = await Character.insertMany(
      parsed.characters.map((c) => ({
        storyId: story._id,
        name: c.name,
        role: c.role,
        description: c.description,
        appearsInEpisodes: c.appearsInEpisodes,
      }))
    );

    const charMap = {};
    for (const doc of characterDocs) charMap[doc.name] = doc._id;

    // Save new Episodes
    const episodes = await Episode.insertMany(
      parsed.episodes.map((ep) => ({
        storyId: story._id,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        characterId: charMap[ep.characterName] || null,
        characterName: ep.characterName,
        sceneDetails: ep.sceneDetails,
        productionNotes: ep.productionNotes,
        lastEditedBy: req.user.id,
      }))
    );

    res.json({ story, heroProfile, characters: characterDocs, episodes });
  } catch (err) {
    console.error('Story regeneration error:', err);
    res.status(500).json({ error: 'Failed to regenerate story: ' + err.message });
  }
});

// PUT /api/stories/:id/title
router.put('/:id/title', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can update the title' });
    }

    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const words = title.trim().split(/\s+/);
    if (words.length !== 2) {
      return res.status(400).json({ error: 'Title must be exactly 2 words in CAPS (e.g. VISA VOWS)' });
    }

    story.title = words.join(' ').toUpperCase();
    await story.save();

    res.json(story);
  } catch (err) {
    console.error('Update title error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// PUT /api/stories/:id/complete
router.put('/:id/complete', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can mark complete' });
    }

    story.status = 'complete';
    await story.save();

    res.json(story);
  } catch (err) {
    console.error('Mark complete error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// PUT /api/stories/:id/status
router.put('/:id/status', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can change status' });
    }

    const { status } = req.body;
    const allowed = ['draft', 'in-progress', 'complete'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }

    story.status = status;
    await story.save();

    res.json(story);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// PUT /api/stories/:storyId/character/:characterId/name
router.put('/:storyId/character/:characterId/name', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can edit character names' });
    }

    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    const trimmed = newName.trim();
    if (trimmed.length > 50) {
      return res.status(400).json({ error: 'Name cannot exceed 50 characters' });
    }

    const character = await Character.findOne({ _id: req.params.characterId, storyId: story._id });
    if (!character) return res.status(404).json({ error: 'Character not found' });

    const oldName = character.name;
    character.name = trimmed;
    await character.save();

    // Update characterName in all episodes that referenced the old name
    const epResult = await Episode.updateMany(
      { storyId: story._id, characterName: oldName },
      { $set: { characterName: trimmed } }
    );

    console.log(`[Name Edit] Character ${req.params.characterId}: "${oldName}" → "${trimmed}", ${epResult.modifiedCount} episodes updated`);

    res.json(character);
  } catch (err) {
    console.error('Character name edit error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// PUT /api/stories/:storyId/hero/name
router.put('/:storyId/hero/name', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can edit the hero name' });
    }

    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    const trimmed = newName.trim();
    if (trimmed.length > 50) {
      return res.status(400).json({ error: 'Name cannot exceed 50 characters' });
    }

    const heroProfile = await HeroProfile.findOne({ storyId: story._id });
    if (!heroProfile) return res.status(404).json({ error: 'Hero profile not found' });

    const oldName = heroProfile.name;
    heroProfile.name = trimmed;
    await heroProfile.save();

    story.heroName = trimmed;
    await story.save();

    // Update characterName in episodes where hero was the character
    const epResult = await Episode.updateMany(
      { storyId: story._id, characterName: oldName },
      { $set: { characterName: trimmed } }
    );

    console.log(`[Name Edit] Hero "${oldName}" → "${trimmed}", story.heroName updated, ${epResult.modifiedCount} episodes updated`);

    res.json(heroProfile);
  } catch (err) {
    console.error('Hero name edit error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// DELETE /api/stories/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.creatorId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can delete' });
    }

    // Collect all image URLs to delete from disk
    const episodes = await Episode.find({ storyId: story._id });
    const characters = await Character.find({ storyId: story._id });

    const imageUrls = [
      story.mainImage,
      story.heroImage,
      ...characters.map((c) => c.image),
      ...episodes.map((e) => e.sceneImage),
    ].filter(Boolean);

    // Delete image files from server/uploads/
    for (const url of imageUrls) {
      deleteImageFile(url);
    }

    // Delete all DB records
    await Promise.all([
      Episode.deleteMany({ storyId: story._id }),
      Character.deleteMany({ storyId: story._id }),
      HeroProfile.deleteOne({ storyId: story._id }),
      Story.findByIdAndDelete(story._id),
    ]);

    console.log(`[Story] Deleted story ${story._id} (${story.title}), removed ${imageUrls.length} image files`);
    res.json({ message: 'Story deleted successfully' });
  } catch (err) {
    console.error('Delete story error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

export default router;
