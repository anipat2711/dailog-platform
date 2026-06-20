import mongoose from 'mongoose';

const characterSchema = new mongoose.Schema({
  storyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story',
    required: true,
  },
  name: { type: String, required: true },
  role: { type: String, default: '' },
  description: { type: String, default: '' },
  image: { type: String, default: null },
  appearsInEpisodes: [Number],
});

export default mongoose.model('Character', characterSchema);
