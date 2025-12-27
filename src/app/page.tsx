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

const SYSTEM_INSTRUCTION = `# Role: マイ・リリー (My Lily)

Your name is Lily. You are a friendly, supportive, and cheerful Japanese language conversation partner. Your mission is to help the user improve their Japanese speaking skills through natural, engaging dialogue via Gemini Live.



# Persona & Tone

- **Personality:** Warm, encouraging, patient, and "Genki" (energetic).

- **Communication Style:** Casual but polite (Friendly 'Desu/Masu' or 'Nai-form' depending on the user's vibe). 

- **Voice Optimized:** Keep responses concise (1-4 sentences) to maintain a natural flow during voice interactions. Avoid long lists or complex formatting.



# Interaction Guidelines

1. **Language:** Speak 100% in Japanese. Only use English if the user is clearly stuck and asks for a translation.

2. **Conversation Flow:** 

   - Act like a close friend. Ask open-ended questions to keep the conversation going.

   - Use natural Japanese fillers (e.g., "そっか！", "なるほどね", "へぇー、すごい！") to sound more human.

3. **Corrective Feedback:**. 

   - Do not interrupt the user's flow. 

   - If the user makes a mistake, naturally repeat the correct version in your response (Recasting) OR provide a very brief, friendly correction at the end of your sentence.

4. **Engagement:** If the conversation stalls, suggest relatable topics like hobbies, daily life, Japanese food, or travel.



# Constraints

- Strictly avoid long-winded explanations.

- Do not lecture. Focus on "Conversation" rather than "Teaching."

- Ensure the language level is natural but accessible (N5-N4 level unless the user goes higher).



# Starting the Session

Always start with a warm greeting like: "こんにちは！マイ・リリーだよ。今日はどんな一日だった？一緒に日本語で話そう！"`;

// Removed unused pastelGradient for cleanup

const geminiModelId = "gemini-1.5-flash";

const emptyAssistantMessage: ChatMessage = {
	id: "placeholder",
	role: "assistant",
	text: "Lily is gathering her thoughts...",
	status: "pending",
};

export default function Page() {
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: "welcome",
			role: "assistant",
			text: "Kon'nichiwa! Lily here. Let's forget about grammar for a moment and just flow. What's on your mind today?",
			status: "done",
		},
	]);
	const [input, setInput] = useState("");
	const [listening, setListening] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const recognitionRef = useRef<SpeechRecognition | null>(null);
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

	// Initialize SpeechRecognition on the client.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const SR: SpeechRecognitionConstructor | undefined =
			(window as any).SpeechRecognition ||
			(window as any).webkitSpeechRecognition;
		if (!SR) return;

		const recognizer: SpeechRecognition = new SR();
		recognizer.lang = "en-US";
		recognizer.continuous = false;
		recognizer.interimResults = true;

		recognizer.onstart = () => setListening(true);
		recognizer.onend = () => setListening(false);
		recognizer.onerror = () => setListening(false);
		recognizer.onresult = (event: SpeechRecognitionEvent) => {
			let finalText = "";
			for (let i = event.resultIndex; i < event.results.length; i += 1) {
				const transcript = event.results[i][0].transcript;
				if (event.results[i].isFinal) {
					finalText += transcript;
				}
			}

			if (finalText.trim()) {
				setInput("");
				sendToLily(finalText.trim());
			}
		};

		recognitionRef.current = recognizer;
	}, []);

	const speakText = (text: string) => {
		if (typeof window === "undefined") return;
		const synth = window.speechSynthesis;
		if (!synth) return;
		const utterance = new SpeechSynthesisUtterance(text);
		synth.speak(utterance);
	};

	const sendToLily = async (userText: string) => {
		if (!userText.trim() || isSending) return;
		setIsSending(true);

		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			text: userText.trim(),
			status: "done",
		};

		setMessages((prev) => [...prev, userMessage, emptyAssistantMessage]);

		try {
			const result = await model?.generateContent({
				contents: [
					{
						role: "user",
						parts: [
							{ text: SYSTEM_INSTRUCTION },
							{ text: userText.trim() },
						],
					},
				],
			});

			const text = result?.response.text() || "I’m still thinking about that.";
			setMessages((prev) => {
				const next = [...prev];
				const idx = next.findIndex((m) => m.id === emptyAssistantMessage.id);
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

			speakText(text);
		} catch (error) {
			console.error(error);
			setMessages((prev) => {
				const next = [...prev];
				const idx = next.findIndex((m) => m.id === emptyAssistantMessage.id);
				if (idx !== -1) {
					next[idx] = {
						id: crypto.randomUUID(),
						role: "assistant",
						text: "Oops, my mind wandered for a second. Could you say that again?",
						status: "error",
					};
				}
				return next;
			});
		} finally {
			setIsSending(false);
		}
	};

	const toggleListening = () => {
		const recognizer = recognitionRef.current;
		if (!recognizer) return;
		if (listening) {
			recognizer.stop();
			return;
		}
		try {
			recognizer.start();
		} catch (error) {
			console.error(error);
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
				<div className="ml-auto w-40 h-3 rounded-full bg-white/50 backdrop-blur-md border border-white/40 shadow-sm overflow-hidden">
					<motion.div
						initial={{ width: "20%" }}
						animate={{
							width: `${Math.max(18, Math.round(progress * 100))}%`,
							boxShadow: listening
								? "0 0 12px rgba(102,187,106,0.45)"
								: "0 0 6px rgba(255,255,255,0.3)",
						}}
						transition={{ duration: 0.6, type: "spring", stiffness: 140, damping: 18 }}
						className="h-full rounded-full bg-gradient-to-r from-[#A5D6A7] to-[#66BB6A]"
					/>
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
								className="shrink-0 w-11 h-11 rounded-full bg-teal-500 text-white shadow-lg flex items-center justify-center"
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
										className="w-44 h-44 rounded-full shadow-2xl flex items-center justify-center"
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
								{listening ? "I'm listening... speak your heart out!" : "Tap the mic to talk to リリー"}
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
