
import React from 'react';
import { Message } from '../types';

interface MessageItemProps {
  message: Message;
}

const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full mb-8 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] md:max-w-[60%] px-6 py-4 rounded-2xl ${
        isUser 
          ? 'bg-neutral-900 text-white shadow-lg' 
          : 'bg-white text-neutral-800 shadow-sm border border-neutral-100'
      }`}>
        <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">
          {message.content}
        </p>
        <div className={`mt-2 text-[10px] uppercase tracking-widest opacity-40 ${
          isUser ? 'text-right' : 'text-left'
        }`}>
          {isUser ? 'You' : 'Zen'} • {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};

export default MessageItem;
