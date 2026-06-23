import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import storyRoutes from './routes/stories.js';
import imageRoutes from './routes/images.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve uploaded images statically
const uploadsPath = path.join(__dirname, 'uploads');
console.log('Serving uploads from:', uploadsPath);
app.use('/uploads', express.static(uploadsPath));

// ─── Rate Limiting ───
// Image generation: max 10 per user per 10 minutes
const imageGenLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many image generations. Please wait a few minutes.' },
});

// Story generation: max 20 per user per 10 minutes
const storyGenLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many story generations. Please wait.' },
});

// Apply rate limits to specific endpoints
app.post('/api/images/:storyId/generate', imageGenLimit);
app.post('/api/stories/generate', storyGenLimit);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/images', imageRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test which Gemini models are available with our API key
app.get('/api/test-models', async (req, res) => {
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?key=' + process.env.GEMINI_API_KEY
    );
    const data = await response.json();
    const imageModels = data.models?.filter(m =>
      m.name.includes('image') ||
      m.name.includes('imagen') ||
      m.name.includes('nano') ||
      m.supportedGenerationMethods?.includes('generateContent')
    );
    res.json({
      imageModels: imageModels?.map(m => m.name),
      allModels: data.models?.map(m => m.name),
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Connect to MongoDB and start server
mongoose
  .connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    bufferCommands: false,
  })
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
