export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    voice?: {
      transcript?: string;
    };
    audio?: {
      transcript?: string;
    };
    document?: {
      transcript?: string;
    };
    chat?: {
      id?: number | string;
    };
  };
}
