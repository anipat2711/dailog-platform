import mongoose from 'mongoose';

const storySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['draft', 'in-progress', 'complete'],
    default: 'draft',
  },
  creatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  creatorName: {
    type: String,
    required: true,
  },
  prompt: {
    type: String,
    required: true,
  },
  userCharacter: {
    type: String,
    default: '',
  },
  heroName: {
    type: String,
    default: '',
  },
  mainImage: {
    type: String,
    default: null,
  },
  heroImage: {
    type: String,
    default: null,
  },
  userRole: {
    type: String,
    default: '',
  },
  transitionMessage: {
    type: String,
    default: '',
  },
  firstMessage: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

storySchema.pre('save', function () {
  this.updatedAt = new Date();
});

// Enable optimistic concurrency control — save() will throw a
// VersionError if another process has modified the document since it was read
storySchema.set('optimisticConcurrency', true);

export default mongoose.model('Story', storySchema);
