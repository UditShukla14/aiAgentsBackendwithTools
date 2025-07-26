import mongoose, { Schema, Document, Model } from 'mongoose';

const MONGO_URI = 'mongodb+srv://doadmin:94f0Pq2rX1768uKe@db-mongodb-nyc1-38465-c4ba6c32.mongo.ondigitalocean.com/?authSource=admin';

// Conversation message subdocument
const MessageSchema = new Schema({
  id: { type: Number, required: true },
  role: { type: String, enum: ['user', 'assistant', 'system', 'error'], required: true },
  content: { type: String, required: true },
  toolUsed: { type: String },
  timestamp: { type: String, required: true },
  streaming: { type: Boolean },
}, { _id: false });

// Conversation session document
const ConversationSchema = new Schema({
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  messages: { type: [MessageSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'conversations' });

export interface IMessage {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  toolUsed?: string | null;
  timestamp: string;
  streaming?: boolean;
}

export interface IConversation extends Document {
  userId: string;
  sessionId: string;
  messages: IMessage[];
  createdAt: Date;
}

let ConversationModel: Model<IConversation>;

export async function connectToMongo() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI, {
      dbName: 'conversation',
    });
  }
  if (!ConversationModel) {
    ConversationModel = mongoose.model<IConversation>('Conversation', ConversationSchema);
  }
}

export async function saveConversation(userId: string, sessionId: string, messages: IMessage[]) {
  await connectToMongo();
  await ConversationModel.findOneAndUpdate(
    { userId, sessionId },
    { $set: { messages, createdAt: new Date() } },
    { upsert: true, new: true }
  );
}

export async function getConversations(userId: string) {
  await connectToMongo();
  return ConversationModel.find({ userId }).sort({ createdAt: -1 }).lean();
}

export async function getConversation(userId: string, sessionId: string) {
  await connectToMongo();
  return ConversationModel.findOne({ userId, sessionId }).lean();
}

export async function deleteConversation(userId: string, sessionId: string) {
  await connectToMongo();
  await ConversationModel.deleteOne({ userId, sessionId });
} 