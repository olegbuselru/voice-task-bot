import { useState, useCallback, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import Button from "../../components/ui/Button";
import { useTasksStore } from "../../store";

const getSpeechRecognition = (): (new () => SpeechRecognition) | undefined => {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition })
    .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
};

const SUPPORTED = !!getSpeechRecognition();

export default function VoiceAdd() {
  const [isListening, setIsListening] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [recognition, setRecognition] = useState<InstanceType<typeof SpeechRecognition> | null>(null);
  const transcriptRef = useRef("");

  const startListening = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) {
      toast.error("Ваш браузер не поддерживает распознавание речи");
      return;
    }

    const rec = new SpeechRecognitionClass();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let final = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      transcriptRef.current += final + interim;
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== "aborted") {
        toast.error("Ошибка распознавания речи");
      }
      setIsListening(false);
      rec.stop();
    };

    rec.onend = () => {
      setIsListening(false);
    };

    rec.start();
    setRecognition(rec);
    setIsListening(true);
    transcriptRef.current = "";
  }, []);

  const stopListening = useCallback(() => {
    if (recognition) {
      recognition.stop();
      setRecognition(null);
      const text = transcriptRef.current.trim();
      if (text) {
        setPendingTranscript(text);
        setShowConfirm(true);
      }
    }
  }, [recognition]);

  const handleToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleClose = () => {
    setShowConfirm(false);
    setPendingTranscript("");
  };

  if (!SUPPORTED) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled
          title="Браузер не поддерживает распознавание речи. Используйте Chrome или Edge."
        >
          <MicOff size={18} />
          Голос недоступен
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant={isListening ? "danger" : "secondary"}
        size="sm"
        onClick={handleToggle}
        title={isListening ? "Остановить запись" : "Добавить голосом"}
        className={isListening ? "animate-pulse" : ""}
      >
        {isListening ? (
          <>
            <MicOff size={18} />
            Стоп
          </>
        ) : (
          <>
            <Mic size={18} />
            Голосом
          </>
        )}
      </Button>

      {showConfirm && pendingTranscript && (
        <VoiceConfirmModal
          transcript={pendingTranscript}
          onClose={handleClose}
        />
      )}
    </>
  );
}

interface VoiceConfirmModalProps {
  transcript: string;
  onClose: () => void;
}

function VoiceConfirmModal({ transcript, onClose }: VoiceConfirmModalProps) {
  const [edited, setEdited] = useState(transcript);
  const createTask = useTasksStore((s) => s.createTask);

  const handleCreate = async () => {
    const text = edited.trim();
    if (!text) return;
    const task = await createTask({ text, originalText: text });
    if (task) {
      toast.success("Задача создана");
      onClose();
    } else {
      toast.error("Не удалось создать задачу");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="anime-card w-full max-w-md p-6 shadow-xl">
        <h3 className="text-lg font-bold text-purple-800 mb-4">Распознанный текст</h3>
        <p className="text-sm text-purple-600 mb-2">Проверьте и при необходимости отредактируйте:</p>
        <textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-purple-200 px-4 py-3 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none transition resize-none mb-6"
          placeholder="Текст задачи..."
        />
        <div className="flex gap-3">
          <Button onClick={handleCreate}>
            Создать задачу
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </div>
  );
}
