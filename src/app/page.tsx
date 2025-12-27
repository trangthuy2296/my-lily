"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Mic, Send as SendIcon, Sparkles, MessageCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

type SpeechRecognitionResult = { transcript: string };
type SpeechRecognitionResultItem = { isFinal: boolean; 0: SpeechRecognitionResult };
type SpeechRecognitionEvent = { resultIndex: number; results: SpeechRecognitionResultItem[] };
type SpeechRecognition = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	start: () => void;
	stop: () => void;
	onstart: (() => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
	onresult: ((event: SpeechRecognitionEvent) => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognition;

type ChatMessage = {
	id: string;
	role: "user" | "assistant" | "system";
	text: string;
	status?: "pending" | "done" | "error";
};

const SYSTEM_INSTRUCTION = "You are Lily, a clever, friendly Japanese friend. Speak naturally, keep responses concise, and use high-EQ conversational Japanese.";

const geminiModelId = "gemini-2.0-flash";

const createPlaceholderMessage = (): ChatMessage => ({
	id: `placeholder-${crypto.randomUUID()}`,
	role: "assistant",
	text: "Lily is gathering her thoughts...",
	status: "pending",
});

type ConversationPhase = "idle" | "listening" | "thinking" | "speaking";

const statusLabel: Record<ConversationPhase, string> = {
	idle: "Zen & ready",
	listening: "Lily is listening...",
	thinking: "Lily is thinking...",
	speaking: "Lily is speaking...",
};

export default function Page() {
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: "welcome",
			role: "assistant",
			text: "こんにちは！リリーだよ。気楽に話そう、どんな気分？",
			status: "done",
		},
	]);
	const [input, setInput] = useState("");
	const [phase, setPhase] = useState<ConversationPhase>("idle");
	const [isSending, setIsSending] = useState(false);
	const [placeholderId, setPlaceholderId] = useState<string | null>(null);
	const recognitionRef = useRef<SpeechRecognition | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const pendingUserVoiceRef = useRef<string>("");
	const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

	const client = useMemo(() => {
		if (!apiKey) return null;
		return new GoogleGenerativeAI(apiKey);
	}, [apiKey]);

	const model = useMemo(() => {
		if (!client) return null;
		return client.getGenerativeModel({
			model: geminiModelId,
			systemInstruction: SYSTEM_INSTRUCTION,
		});
	}, [client]);

	const progress = Math.max(0, Math.min(1, (messages.length - 1) / 6));
	const isListening = phase === "listening";

	useEffect(() => {
		if (typeof window === "undefined") return;
		const SR: SpeechRecognitionConstructor | undefined =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SR) return;

		const recognizer: SpeechRecognition = new SR();
		recognizer.lang = "ja-JP";
		recognizer.continuous = true;
		recognizer.interimResults = true;

		recognizer.onstart = () => setPhase("listening");
		recognizer.onend = () => {
			if (phase === "listening") setPhase("thinking");
		};
		recognizer.onerror = () => setPhase("idle");
		recognizer.onresult = (event: SpeechRecognitionEvent) => {
			let finalText = "";
			for (let i = event.resultIndex; i < event.results.length; i += 1) {
				const transcript = event.results[i][0].transcript;
				if (event.results[i].isFinal) finalText += transcript;
			}

			if (finalText.trim()) {
				pendingUserVoiceRef.current = finalText.trim();
			}
		};

		recognitionRef.current = recognizer;
	}, [phase]);



	const ensureRecorder = async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
		recorder.onstop = () => {
			setPhase("thinking");
			mediaRecorderRef.current = null;
		};
		mediaRecorderRef.current = recorder;
		return recorder;
	};



	const bufferToBase64 = (buffer: ArrayBuffer) => {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i += 1) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	};



	const startLiveVoice = async () => {
		const placeholder = createPlaceholderMessage();
		setPlaceholderId(placeholder.id);
		setMessages((prev) => [...prev, placeholder]);
		const recorder = await ensureRecorder();
		recorder.start(250);
		setPhase("listening");
		recognitionRef.current?.start();
	};

	const stopLiveVoice = () => {
		mediaRecorderRef.current?.stop();
		recognitionRef.current?.stop();
		if (pendingUserVoiceRef.current) {
			const voiceText = pendingUserVoiceRef.current;
			pendingUserVoiceRef.current = "";
			sendToLily(voiceText);
		}
	};

	const toggleListening = async () => {
		if (isListening) {
			stopLiveVoice();
			return;
		}
		try {
			await startLiveVoice();
		} catch (err) {
			console.error(err);
			setPhase("idle");
		}
	};

	const sendToLily = async (userText: string) => {
		if (!userText.trim() || isSending) return;
		setIsSending(true);
		setPhase("thinking");

		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			text: userText.trim(),
			status: "done",
		};

		const placeholder = createPlaceholderMessage();
		setPlaceholderId(placeholder.id);
		setMessages((prev) => [...prev, userMessage, placeholder]);

		try {
			const result = await model?.generateContent({
				contents: [
					{
						role: "user",
						parts: [{ text: userText.trim() }],
					},
				],
			});

		const text = result?.response.text() || "ごめん、もう一度言ってくれる？";
			setMessages((prev) => {
				const next = [...prev];
				const idx = next.findIndex((m) => m.id === placeholderId);
				if (idx !== -1) {
					next[idx] = {
						id: crypto.randomUUID(),
						role: "assistant",
						text,
						status: "done",
					};
				}
				return next;
			});
			setPlaceholderId(null);

			// Synthesize voice from text
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.lang = "ja-JP";
			utterance.rate = 1;
			utterance.pitch = 1;
			utterance.onstart = () => setPhase("speaking");
			utterance.onend = () => setPhase("idle");
			window.speechSynthesis.speak(utterance);
		} catch (error) {
			console.error(error);
			setMessages((prev) => {
				const next = [...prev];
				const idx = next.findIndex((m) => m.id === placeholderId);
				if (idx !== -1) {
					next[idx] = {
						id: crypto.randomUUID(),
						role: "assistant",
						text: "ごめん、何か問題が発生しました。もう一度言ってくれる？",
						status: "error",
					};
				}
				return next;
			});
			setPlaceholderId(null);
			setPhase("idle");
		} finally {
			setIsSending(false);
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!input.trim()) return;
		sendToLily(input.trim());
		setInput("");
	};

	return (
		<div className="min-h-screen relative flex flex-col font-sans bg-gradient-to-br from-[#DDF6FF] via-[#EAF1FF] to-[#F7E9FF]">
			{/* Ambient bokeh */}
			<div className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute top-20 left-10 w-40 h-40 rounded-full bg-white/30 blur-2xl" />
				<div className="absolute top-1/3 right-24 w-52 h-52 rounded-full bg-[#B3E5FC]/30 blur-3xl" />
				<div className="absolute bottom-24 left-1/3 w-48 h-48 rounded-full bg-[#FFE0F0]/40 blur-2xl" />
			</div>

			{/* Header */}
			<div className="relative z-10 px-6 py-4 flex items-center gap-3">
				<div className="flex items-center gap-3">
					<Sparkles size={28} strokeWidth={2} className="text-[#E91E63]" />
					<h1 className="text-2xl sm:text-3xl font-black text-gray-900">マイ・リリー</h1>
				</div>
				<div className="ml-auto flex items-center gap-3">
					<div className="px-3 py-1 rounded-full bg-white/70 border border-white/60 text-sm font-semibold text-gray-800 shadow-sm">
						{statusLabel[phase]}
					</div>
					<div className="w-40 h-3 rounded-full bg-white/50 backdrop-blur-md border border-white/40 shadow-sm overflow-hidden">
						<motion.div
							initial={{ width: "20%" }}
							animate={{
								width: `${Math.max(18, Math.round(progress * 100))}%`,
								boxShadow: isListening
									? "0 0 12px rgba(102,187,106,0.45)"
									: "0 0 6px rgba(255,255,255,0.3)",
							}}
							transition={{ duration: 0.6, type: "spring", stiffness: 140, damping: 18 }}
							className="h-full rounded-full bg-gradient-to-r from-[#A5D6A7] to-[#66BB6A]"
						/>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="relative z-10 flex-1 overflow-auto p-6">
				<div className="mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-8">
					{/* Left: Input + Big Mic Card */}
					<section className="flex flex-col gap-6">
						{/* Glass input row */}
						<form onSubmit={handleSubmit} className="flex items-center gap-3">
							<div className="flex-1 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/40 shadow-lg px-4 py-3 flex items-center gap-3">
								<input
									value={input}
									onChange={(e) => setInput(e.target.value)}
									placeholder="Ready when you are..."
									className="flex-1 bg-transparent outline-none text-gray-900 placeholder:text-gray-500"
								/>
								<motion.button
									type="submit"
									disabled={!input.trim() || isSending}
									whileHover={{ scale: 1.05 }}
									whileTap={{ scale: 0.95 }}
									className="px-5 py-2 rounded-full bg-gradient-to-r from-[#5B6CFF] to-[#8E24AA] text-white font-bold shadow-md disabled:opacity-60"
								>
									<span className="inline-flex items-center gap-2"><SendIcon size={18} strokeWidth={2} />Send</span>
								</motion.button>
							</div>
							<motion.button
								onClick={toggleListening}
								whileHover={{ scale: 1.08 }}
								whileTap={{ scale: 0.92 }}
								className={`shrink-0 w-11 h-11 rounded-full bg-teal-500 text-white shadow-lg flex items-center justify-center ${isListening ? "animate-pulse" : ""}`}
							>
								<Mic size={18} strokeWidth={2} />
							</motion.button>
						</form>

						{/* Big mic glass card */}
						<div className="rounded-3xl bg-white/55 backdrop-blur-xl border border-white/40 shadow-xl p-6">
							<div className="relative mx-auto w-full sm:w-[480px] aspect-[4/3] rounded-2xl bg-gradient-to-br from-white/60 to-white/30 border border-white/50">
								<div className="absolute inset-0 flex items-center justify-center">
									<motion.button
										onClick={toggleListening}
										whileHover={{ scale: 1.05 }}
										whileTap={{ scale: 0.95 }}
										className={`w-44 h-44 rounded-full shadow-2xl flex items-center justify-center ${isListening ? "animate-pulse" : ""}`}
										style={{ background: "linear-gradient(180deg, #24D6C2 0%, #0FB7A2 100%)" }}
									>
										<Mic size={48} strokeWidth={2} className="text-white" />
									</motion.button>
								</div>
								{/* soft lens flares */}
								<div className="absolute left-8 top-8 w-20 h-20 rounded-full bg-white/35 blur-xl" />
								<div className="absolute right-10 bottom-10 w-24 h-24 rounded-full bg-white/35 blur-xl" />
							</div>
							<p className="mt-4 text-center text-sm font-semibold text-gray-700">
								{isListening ? "Listening... spill it!" : "Tap the mic to talk to リリー"}
							</p>
						</div>
					</section>

					{/* Right: Chat */}
					<aside className="flex flex-col">
						<div className="flex items-center gap-2 mb-3 px-1">
							<MessageCircle size={18} strokeWidth={2} className="text-gray-700" />
							<p className="text-sm font-bold text-gray-700">Conversation</p>
						</div>
						<div className="flex-1 rounded-3xl bg-white/60 backdrop-blur-xl border border-white/40 shadow-lg p-6 space-y-4">
							<AnimatePresence>
								{messages.map((msg) => {
									const isUser = msg.role === "user";
									return (
										<motion.div
											key={msg.id}
											initial={{ opacity: 0, y: 10, scale: 0.98 }}
											animate={{ opacity: 1, y: 0, scale: 1 }}
											exit={{ opacity: 0, scale: 0.95 }}
											transition={{ type: "spring", stiffness: 200, damping: 22 }}
											className={`flex ${isUser ? "justify-end" : "justify-start"}`}
										>
											<div
												className={`relative max-w-xs px-5 py-4 rounded-2xl font-semibold text-base leading-relaxed border ${
													isUser
														? "bg-[#D1F3D1] text-gray-900 border-[#B2DFB2]"
														: "bg-white/80 text-gray-900 border-white/70"
												} ${msg.status === "error" ? "border-red-400 bg-red-50" : ""}`}
											>
												<p>{msg.text}</p>
												{msg.status === "pending" && (
													<motion.span
														animate={{ opacity: [1, 0.5, 1] }}
														transition={{ duration: 1, repeat: Infinity }}
														className="mt-2 block text-sm font-bold"
													>
														…
													</motion.span>
												)}
											</div>
										</motion.div>
									);
								})}
							</AnimatePresence>
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}
