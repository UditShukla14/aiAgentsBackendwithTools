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
  title: { type: String, default: '' }, // Add title field
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
  title: string; // Add title to interface
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

export async function saveConversation(userId: string, sessionId: string, messages: IMessage[], title?: string) {
  await connectToMongo();
  
  // If no title provided, generate one from messages
  let finalTitle = title;
  if (!finalTitle) {
    finalTitle = generateTitleFromMessages(messages);
  }
  
  const updateData: any = { messages, createdAt: new Date(), title: finalTitle };
  
  await ConversationModel.findOneAndUpdate(
    { userId, sessionId },
    { $set: updateData },
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

export async function updateConversationTitle(userId: string, sessionId: string, title: string) {
  await connectToMongo();
  await ConversationModel.findOneAndUpdate(
    { userId, sessionId },
    { $set: { title } },
    { new: true }
  );
}

// Utility function to generate title from first user message
export function generateTitleFromMessages(messages: IMessage[]): string {
  if (!messages || messages.length === 0) {
    return 'New Conversation';
  }
  
  // Find the first user message
  const firstUserMessage = messages.find(msg => msg.role === 'user');
  if (!firstUserMessage) {
    return 'New Conversation';
  }
  
  // Extract title from first user message
  let title = firstUserMessage.content.trim();
  
  // Limit title length
  if (title.length > 50) {
    title = title.substring(0, 47) + '...';
  }
  
  // Remove common prefixes that don't make good titles
  title = title.replace(/^(hi|hello|hey|can you|please|help me|i need|i want|show me|find|search for|get|tell me|what is|how do|when|where|who)\s+/i, '');
  
  // Capitalize first letter
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  
  return title || 'New Conversation';
} 