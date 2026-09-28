"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { ArrowUp, Bot, Check, ChevronDown, CircleHelp, Command, Database, Menu, MessageSquareText, MoreHorizontal, PanelLeftClose, Plus, Search, Settings, Sparkles, UserRound, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

type Message = { id: number; role: "assistant" | "user"; content: string };

const conversations = [
  { title: "Platform launch plan", age: "Now", active: true },
  { title: "Supabase schema ideas", age: "2h" },
  { title: "API rate-limit strategy", age: "1d" },
  { title: "Onboarding copy", age: "3d" },
];

const initialMessages: Message[] = [
  { id: 1, role: "assistant", content: "Welcome to your AI workspace. The Next.js app is live, Supabase is connected, and the foundation is ready for your first feature." },
  { id: 2, role: "user", content: "What should we build first?" },
  { id: 3, role: "assistant", content: "Start with one valuable workflow: authenticated chat, saved conversation history, and a protected API route. Then add rate limits, observability, and background jobs as usage grows." },
];

export default function Home() {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sending, setSending] = useState(false);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    const now = Date.now();
    setMessages((current) => [...current, { id: now, role: "user", content }]);
    setDraft("");
    setSending(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_AI_API_URL;
      if (!apiUrl) throw new Error("The AI service URL is not configured.");

      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) {
        throw new Error("Sign in is required before using the guarded AI service.");
      }

      const response = await fetch(`${apiUrl}/v1/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [{ role: "user", content }], max_output_tokens: 512 }),
      });
      const result = await response.json();
      if (!response.ok) {
        const code = result?.detail?.code ?? "ai_request_failed";
        throw new Error(code === "no_ai_provider_configured" ? "The secure AI service is ready. Add a Groq or Gemini key to enable live answers." : `Request stopped safely: ${code.replaceAll("_", " ")}.`);
      }
      setMessages((current) => [...current, { id: now + 1, role: "assistant", content: result.content }]);
    } catch (error) {
      setMessages((current) => [...current, { id: now + 1, role: "assistant", content: error instanceof Error ? error.message : "The AI service is temporarily unavailable." }]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className="min-h-screen bg-[#080b12] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] overflow-hidden border-x border-white/[0.06] bg-[#0b0f18]">
        {sidebarOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-white/[0.07] bg-[#0d111b] transition-transform duration-200 lg:static lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-4">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-xl bg-blue-500 text-white shadow-[0_0_24px_rgba(59,130,246,0.25)]"><Command className="size-5" /></div>
              <div><p className="text-sm font-semibold tracking-tight">Nexora</p><p className="text-[11px] text-slate-500">AI workspace</p></div>
            </div>
            <Button aria-label="Close sidebar" className="text-slate-500 lg:hidden" onClick={() => setSidebarOpen(false)} size="icon" variant="ghost"><PanelLeftClose /></Button>
          </div>

          <div className="space-y-2 p-3">
            <Button className="h-10 w-full justify-start gap-2 bg-blue-500 px-3 text-white hover:bg-blue-400"><Plus className="size-4" />New conversation</Button>
            <button className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-slate-400 transition hover:bg-white/[0.05] hover:text-white"><Search className="size-4" />Search<span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">⌘ K</span></button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.16em] text-slate-600 uppercase">Recent</p>
            <nav aria-label="Recent conversations" className="space-y-1">
              {conversations.map((conversation) => (
                <button key={conversation.title} className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${conversation.active ? "bg-white/[0.07] text-white" : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"}`}>
                  <MessageSquareText className={`size-4 ${conversation.active ? "text-blue-400" : "text-slate-600"}`} />
                  <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                  <span className="text-[10px] text-slate-600 group-hover:hidden">{conversation.age}</span>
                  <MoreHorizontal className="hidden size-4 text-slate-500 group-hover:block" />
                </button>
              ))}
            </nav>
          </div>

          <div className="border-t border-white/[0.07] p-3">
            <div className="mb-2 rounded-xl border border-blue-400/15 bg-blue-400/[0.05] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-300"><Sparkles className="size-3.5" />Production foundation</div>
              <p className="text-[11px] leading-5 text-slate-500">Next.js and Supabase are connected. Add live AI when you’re ready.</p>
            </div>
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.04]">
              <div className="grid size-8 place-items-center rounded-lg bg-slate-800 text-xs font-semibold text-slate-300">KS</div>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-300">Workspace owner</p><p className="text-[10px] text-slate-600">Free workspace</p></div>
              <Settings className="size-4 text-slate-600" />
            </button>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4 sm:px-6">
            <Button aria-label="Open navigation" className="text-slate-400 lg:hidden" onClick={() => setSidebarOpen(true)} size="icon" variant="ghost"><Menu /></Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="truncate text-sm font-semibold">Platform launch plan</h1><Badge className="border-emerald-400/20 bg-emerald-400/10 text-[10px] text-emerald-300" variant="outline">Guarded API</Badge></div>
              <p className="text-[11px] text-slate-600">Private conversation</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[11px] text-slate-400 sm:flex"><span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />Systems ready</div>
              <Button aria-label="Help" className="text-slate-500" size="icon" variant="ghost"><CircleHelp /></Button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <div className="relative flex min-w-0 flex-1 flex-col">
              <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:48px_48px]" />
              <div className="relative flex-1 overflow-y-auto px-4 py-8 sm:px-8">
                <div className="mx-auto max-w-3xl">
                  <div className="mb-9 flex items-end justify-between gap-4 border-b border-white/[0.07] pb-6">
                    <div><p className="mb-2 font-mono text-[10px] tracking-[0.18em] text-blue-400 uppercase">Workspace / 001</p><h2 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">Build something valuable.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">A focused place to plan, build, and run your AI product.</p></div>
                    <div className="hidden rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 text-right sm:block"><p className="font-mono text-[9px] tracking-wider text-slate-600 uppercase">Messages</p><p className="mt-0.5 font-mono text-sm text-slate-300">{String(messages.length).padStart(2, "0")}</p></div>
                  </div>

                  <div aria-live="polite" className="space-y-7">
                    {messages.map((message) => (
                      <article className="flex gap-3 sm:gap-4" key={message.id}>
                        <div className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border ${message.role === "assistant" ? "border-blue-400/20 bg-blue-400/10 text-blue-300" : "border-white/10 bg-white/[0.05] text-slate-400"}`}>{message.role === "assistant" ? <Bot className="size-4" /> : <UserRound className="size-4" />}</div>
                        <div className="min-w-0 flex-1 pt-0.5"><div className="mb-1.5 flex items-center gap-2"><p className="text-xs font-semibold text-slate-300">{message.role === "assistant" ? "Nexora" : "You"}</p>{message.role === "assistant" && <span className="font-mono text-[9px] tracking-wider text-blue-400/70 uppercase">Assistant</span>}</div><p className="max-w-2xl text-sm leading-7 text-slate-400">{message.content}</p></div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative border-t border-white/[0.06] bg-[#0b0f18]/95 px-4 py-4 backdrop-blur-xl sm:px-8 sm:py-5">
                <form className="mx-auto max-w-3xl" onSubmit={sendMessage}>
                  <div className="rounded-2xl border border-white/10 bg-[#111722] p-2 shadow-[0_20px_60px_rgba(0,0,0,0.28)] transition focus-within:border-blue-400/35 focus-within:ring-4 focus-within:ring-blue-400/[0.06]">
                    <Textarea aria-label="Message Nexora" className="min-h-14 resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-slate-200 shadow-none placeholder:text-slate-600 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent" onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask about your product, architecture, or next feature…" value={draft} />
                    <div className="flex items-center justify-between gap-3 px-1 pt-1">
                      <button className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300" type="button"><Zap className="size-3.5 text-blue-400" />Groq → Gemini<ChevronDown className="size-3" /></button>
                      <Button aria-label="Send message" className="size-8 rounded-xl bg-blue-500 text-white hover:bg-blue-400" disabled={!draft.trim() || sending} size="icon" type="submit"><ArrowUp className="size-4" /></Button>
                    </div>
                  </div>
                  <p className="mt-2 text-center text-[10px] text-slate-700">Enter to send · Sign-in and usage limits are enforced · {sending ? "Contacting provider…" : "Ready"}</p>
                </form>
              </div>
            </div>

            <aside className="hidden w-64 shrink-0 border-l border-white/[0.07] bg-[#0d111b] p-5 xl:block">
              <p className="font-mono text-[10px] tracking-[0.16em] text-slate-600 uppercase">Environment</p>
              <div className="mt-4 space-y-3">
                <StatusCard icon={<Zap className="size-4" />} label="Application" meta="Next.js 16" />
                <StatusCard icon={<Database className="size-4" />} label="Database" meta="Supabase · Mumbai" />
                <StatusCard icon={<Check className="size-4" />} label="Deployment" meta="Vercel · Production" />
              </div>
              <div className="mt-7 border-t border-white/[0.07] pt-5"><p className="font-mono text-[10px] tracking-[0.16em] text-slate-600 uppercase">Next milestone</p><div className="mt-4 flex gap-3"><div className="mt-1 size-1.5 shrink-0 rounded-full bg-blue-400" /><div><p className="text-xs font-medium text-slate-300">Enable live AI</p><p className="mt-1 text-[11px] leading-5 text-slate-600">Add your OpenAI key, secure the API route, and store chat history.</p></div></div></div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusCard({ icon, label, meta }: { icon: React.ReactNode; label: string; meta: string }) {
  return <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="flex items-center gap-2 text-slate-400"><span className="text-emerald-400">{icon}</span><span className="text-xs font-medium">{label}</span><span className="ml-auto size-1.5 rounded-full bg-emerald-400" /></div><p className="mt-2 pl-6 font-mono text-[10px] text-slate-600">{meta}</p></div>;
}
