import mongoose from 'mongoose';

const heroProfileSchema = new mongoose.Schema({
  storyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story',
    required: true,
  },
  name: { type: String, default: '' },
  age: { type: String, default: '' },
  background: { type: String, default: '' },
  family: { type: String, default: '' },
  personality: { type: String, default: '' },
  weakness: { type: String, default: '' },
  strength: { type: String, default: '' },
  currentSituation: { type: String, default: '' },
  goal: { type: String, default: '' },
});

export default mongoose.model('HeroProfile', heroProfileSchema);
