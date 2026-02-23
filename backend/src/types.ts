export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: {
      id?: number | string;
    };
  };
}
