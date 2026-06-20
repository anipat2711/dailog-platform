import mongoose from 'mongoose';

const generationStatusSchema = new mongoose.Schema({
  storyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story',
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ['running', 'complete', 'failed'],
    default: 'running',
  },
  total: { type: Number, default: 0 },
  completed: { type: Number, default: 0 },
  failed: { type: [mongoose.Schema.Types.Mixed], default: [] },
  phase: { type: String, default: 'Starting...' },
  current: { type: String, default: '' },
  error: { type: String, default: null },
  startedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('GenerationStatus', generationStatusSchema);
