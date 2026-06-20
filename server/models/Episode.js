import mongoose from 'mongoose';

const episodeSchema = new mongoose.Schema({
  storyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story',
    required: true,
  },
  episodeNumber: {
    type: Number,
    required: true,
  },
  title: {
    type: String,
    default: '',
  },
  characterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Character',
    default: null,
  },
  characterName: {
    type: String,
    default: '',
  },
  sceneDetails: {
    type: String,
    default: '',
  },
  productionNotes: {
    type: String,
    default: '',
  },
  sceneImage: {
    type: String,
    default: null,
  },
  lastEditedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('Episode', episodeSchema);
