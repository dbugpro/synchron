
export type Role = 'user' | 'model';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
}

export interface Transcription {
  text: string;
  role: Role;
  isComplete: boolean;
}
