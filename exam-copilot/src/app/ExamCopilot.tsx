"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, FileText, MessageSquare, ClipboardList, BarChart3, Send,
  ChevronLeft, ChevronRight, Play, Clock, CheckCircle2, XCircle,
  AlertTriangle, ExternalLink, Video, Image as ImageIcon, Link2,
  Sparkles, Brain, Target, TrendingUp, Award, Zap, Timer, ArrowRight,
  BookMarked, GraduationCap, FlaskConical, Atom, Flame, Lightbulb,
  Search, Globe, FileQuestion, RotateCcw, Shield, ChevronDown,
  ChevronUp, Eye, X, Upload, Layers, Network, CalendarDays,
  RefreshCw, Wand2, StickyNote, CircleDot, GitBranch, Repeat,
  BarChart2, Activity, Cpu, Database, Trash2, FileUp,
  MinusCircle, type LucideIcon, PlusCircle, Settings, Loader2,
} from "lucide-react";

// ══════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION (CDN-based to avoid SSR bundling issues)
// ══════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLibPromise: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  if (pdfjsLibPromise) return pdfjsLibPromise;
  pdfjsLibPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") { reject(new Error("Not in browser")); return; }
    // Check if already loaded
    if ((window as any).pdfjsLib) { resolve((window as any).pdfjsLib); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs";
    script.type = "module";
    // Use a module script approach
    const moduleScript = document.createElement("script");
    moduleScript.type = "module";
    moduleScript.textContent = `
      import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs";
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs";
      window.pdfjsLib = pdfjsLib;
      window.dispatchEvent(new Event("pdfjsReady"));
    `;
    document.head.appendChild(moduleScript);
    const handler = () => {
      window.removeEventListener("pdfjsReady", handler);
      resolve((window as any).pdfjsLib);
    };
    window.addEventListener("pdfjsReady", handler);
    // Timeout fallback
    setTimeout(() => {
      if ((window as any).pdfjsLib) resolve((window as any).pdfjsLib);
      else reject(new Error("PDF.js load timeout"));
    }, 10000);
  });
  return pdfjsLibPromise;
}

async function extractPdfText(file: File): Promise<{ pages: { pageNum: number; text: string }[]; totalPages: number }> {
  const pdfjsLib = await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: { pageNum: number; text: string }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = structureAwareExtract(textContent.items);
    if (text.length > 10) {
      pages.push({ pageNum: i, text });
    }
  }
  return { pages, totalPages: pdf.numPages };
}

// Structure-aware text extraction using PDF.js text item positions
function structureAwareExtract(items: any[]): string {
  if (!items || items.length === 0) return "";

  // Each item has: str, transform[4]=x, transform[5]=y, height, fontName
  type TextItem = { str: string; x: number; y: number; fontSize: number; fontName: string };
  
  const textItems: TextItem[] = items
    .filter((item: any) => item.str && item.str.trim().length > 0)
    .map((item: any) => ({
      str: item.str,
      x: item.transform ? item.transform[4] : 0,
      y: item.transform ? item.transform[5] : 0,
      fontSize: item.transform ? Math.abs(item.transform[3]) || item.height || 12 : 12,
      fontName: item.fontName || "",
    }));

  if (textItems.length === 0) return "";

  // Calculate median font size (body text baseline)
  const fontSizes = textItems.map((t) => t.fontSize).sort((a, b) => a - b);
  const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 12;
  const headingThreshold = medianFontSize * 1.2;

  // Group items into lines by Y-coordinate (items on the same Y are on the same line)
  const lines: { items: TextItem[]; y: number; maxFontSize: number; isBold: boolean }[] = [];
  const Y_TOLERANCE = 3; // pixels

  for (const item of textItems) {
    const existingLine = lines.find((l) => Math.abs(l.y - item.y) < Y_TOLERANCE);
    if (existingLine) {
      existingLine.items.push(item);
      existingLine.maxFontSize = Math.max(existingLine.maxFontSize, item.fontSize);
      if (item.fontName.toLowerCase().includes("bold")) existingLine.isBold = true;
    } else {
      lines.push({
        items: [item],
        y: item.y,
        maxFontSize: item.fontSize,
        isBold: item.fontName.toLowerCase().includes("bold"),
      });
    }
  }

  // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
  lines.sort((a, b) => b.y - a.y);

  // Build structured text
  const outputLines: string[] = [];
  let prevY = lines[0]?.y || 0;

  for (const line of lines) {
    // Sort items left-to-right within each line
    line.items.sort((a, b) => a.x - b.x);
    const lineText = line.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    if (!lineText) continue;

    // Detect paragraph break (large Y gap = blank line between paragraphs)
    const yGap = Math.abs(prevY - line.y);
    if (yGap > medianFontSize * 2.5 && outputLines.length > 0) {
      outputLines.push(""); // Insert blank line for paragraph break
    }

    // Detect heading (larger font or bold + short line)
    const isHeading = line.maxFontSize > headingThreshold || 
      (line.isBold && lineText.length < 100 && !lineText.endsWith("."));

    if (isHeading) {
      // Add markdown heading
      const level = line.maxFontSize > medianFontSize * 1.5 ? "##" : "###";
      outputLines.push(`${level} ${lineText}`);
    } else {
      outputLines.push(lineText);
    }

    prevY = line.y;
  }

  return outputLines.join("\n");
}

// Pre-process document text: detect and label structural sections
function preprocessDocumentText(rawText: string): string {
  const lines = rawText.split("\n");
  const processed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (keep them for paragraph spacing)
    if (!trimmed) { processed.push(""); continue; }

    // Detect section patterns and promote to headings if not already
    if (!trimmed.startsWith("#")) {
      // Experiment headers
      if (/^(experiment|exp\.?)\s*(no\.?|number)?\s*\d+/i.test(trimmed)) {
        line = `## ${trimmed}`;
      }
      // Common section headers in lab manuals / textbooks
      else if (/^(aim|objective|purpose|goal)\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(apparatus|materials?|equipment|requirements?)\s*(required|needed|used)?\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(procedure|method|steps?|process)\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(observation|result|reading|data|measurement)\s*s?\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(conclusion|summary|inference|discussion)\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(formula|equation|expression|calculation)\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(theory|principle|introduction|background)\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(precaution|safety|warning|note)\s*s?\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      else if (/^(diagram|figure|fig\.?)\s*\d*/i.test(trimmed) && trimmed.length < 80) {
        line = `### ${trimmed}`;
      }
      // Chapter/unit headers
      else if (/^(chapter|unit|module|section|part)\s*\d+/i.test(trimmed)) {
        line = `## ${trimmed}`;
      }
      // Definition patterns
      else if (/^(definition|def\.?)\s*[:.\-]/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      // Q&A patterns
      else if (/^(question|q\.?|problem)\s*\d+/i.test(trimmed)) {
        line = `### ${trimmed}`;
      }
      // Short bold-looking lines (all caps or ending with colon, likely a heading)
      else if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80 && /[A-Z]/.test(trimmed)) {
        line = `### ${trimmed}`;
      }
    }

    processed.push(line);
  }

  return processed.join("\n");
}

function extractTextFromTxt(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(file);
  });
}

// ══════════════════════════════════════════════════════════════
// SEARCH ENGINE v2 — Smart passage retrieval with number awareness,
// phrase matching, proximity scoring, and context extraction
// ══════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "can", "could", "of", "in", "to", "for",
  "with", "on", "at", "by", "from", "as", "into", "about", "it", "its",
  "this", "that", "these", "those", "and", "or", "but", "not", "no",
  "if", "then", "than", "so", "up", "out", "just", "also", "very",
  "what", "which", "who", "how", "when", "where", "why", "all", "each",
  "every", "any", "both", "such", "me", "my", "i", "we", "our", "you",
  "your", "he", "she", "they", "them", "his", "her",
]);

// Split long page text into sentences for better matching
function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries while keeping meaningful chunks
  const raw = text
    .replace(/([.!?])\s+/g, "$1\n")
    .replace(/([;:])\s+/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  // Also handle cases where PDF text is one continuous blob — split at ~200 char boundaries
  const result: string[] = [];
  for (const s of raw) {
    if (s.length > 300) {
      // Try splitting at comma or conjunction boundaries
      const chunks = s.match(/.{1,250}[^,;]*[,;]?\s*/g) || [s];
      result.push(...chunks.map((c) => c.trim()).filter((c) => c.length > 10));
    } else {
      result.push(s);
    }
  }
  return result;
}

// Generate number variant patterns: "5" -> ["5", "no.5", "no. 5", "no 5", "number 5", "#5", "05"]
function getNumberVariants(num: string): string[] {
  const n = num.trim();
  if (!/^\d+$/.test(n)) return [n];
  const padded = n.padStart(2, "0");
  return [
    n,
    `no.${n}`, `no. ${n}`, `no ${n}`, `no.${padded}`, `no. ${padded}`,
    `number ${n}`, `#${n}`,
    `experiment ${n}`, `experiment no. ${n}`, `experiment no.${n}`,
    `exp ${n}`, `exp. ${n}`, `exp no. ${n}`,
    `question ${n}`, `q.${n}`, `q. ${n}`, `q ${n}`,
    `chapter ${n}`, `ch.${n}`, `ch. ${n}`, `ch ${n}`,
    `section ${n}`, `sec.${n}`, `sec. ${n}`,
    `unit ${n}`, `part ${n}`, `figure ${n}`, `fig.${n}`, `fig. ${n}`,
    `table ${n}`, `page ${n}`,
    padded,
  ];
}

// Extract numbers from query
function extractNumbers(query: string): string[] {
  const matches = query.match(/\d+/g);
  return matches || [];
}

// Generate bigrams and trigrams from words
function generateNgrams(words: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    grams.push(words.slice(i, i + n).join(" "));
  }
  return grams;
}

// Calculate proximity score — how close query words appear to each other in the text
function proximityScore(contentLower: string, queryWords: string[]): number {
  if (queryWords.length < 2) return 0;
  const positions: number[][] = queryWords.map((w) => {
    const pos: number[] = [];
    let idx = contentLower.indexOf(w);
    while (idx !== -1) {
      pos.push(idx);
      idx = contentLower.indexOf(w, idx + 1);
    }
    return pos;
  }).filter((p) => p.length > 0);

  if (positions.length < 2) return 0;

  // Find minimum span that contains at least one instance of each word
  let bestSpan = Infinity;
  for (const pos0 of positions[0]) {
    for (const pos1 of positions[positions.length - 1]) {
      const span = Math.abs(pos1 - pos0);
      if (span < bestSpan) bestSpan = span;
    }
  }

  // Shorter spans = higher scores
  if (bestSpan < 30) return 200;
  if (bestSpan < 80) return 120;
  if (bestSpan < 200) return 60;
  if (bestSpan < 500) return 20;
  return 5;
}

interface SearchResult {
  page: { pageNum: number; title: string; content: string; docName: string };
  matchedPassages: string[];
  score: number;
  matchType: "exact" | "phrase" | "number" | "keyword";
}

function searchDocuments(
  query: string,
  pages: { pageNum: number; title: string; content: string; docName: string }[]
): SearchResult[] {
  const queryLower = query.toLowerCase().trim();
  const allWords = queryLower.split(/\s+/);
  const queryWords = allWords.filter((w) => !STOP_WORDS.has(w) && w.length > 0);
  const contentWords = allWords.filter((w) => w.length > 0); // Keep ALL words for phrase matching
  const numbers = extractNumbers(queryLower);

  if (queryWords.length === 0 && numbers.length === 0) return [];

  const scored: SearchResult[] = pages.map((page) => {
    const contentLower = page.content.toLowerCase();
    const sentences = splitIntoSentences(page.content);
    let score = 0;
    let matchType: SearchResult["matchType"] = "keyword";
    const matchedPassages: string[] = [];
    const addedPassages = new Set<string>();

    const addPassage = (text: string) => {
      const key = text.substring(0, 60);
      if (!addedPassages.has(key)) {
        addedPassages.add(key);
        matchedPassages.push(text.trim());
      }
    };

    // ─── TIER 1: Exact phrase match (highest priority) ───
    if (contentLower.includes(queryLower)) {
      score += 500;
      matchType = "exact";
      // Find the sentence containing the exact match
      for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(queryLower)) {
          addPassage(sentence);
        }
      }
    }

    // ─── TIER 2: Number-aware matching ───
    if (numbers.length > 0) {
      for (const num of numbers) {
        const variants = getNumberVariants(num);
        for (const variant of variants) {
          if (contentLower.includes(variant.toLowerCase())) {
            score += 300;
            matchType = matchType === "exact" ? "exact" : "number";
            // Find sentences with this number variant
            for (const sentence of sentences) {
              if (sentence.toLowerCase().includes(variant.toLowerCase())) {
                addPassage(sentence);
              }
            }
            break; // Found one variant, that's enough per number
          }
        }
      }

      // Special: Check if the number AND a key concept word appear in the same sentence
      const conceptWords = queryWords.filter((w) => !(/^\d+$/.test(w)));
      for (const sentence of sentences) {
        const sentLower = sentence.toLowerCase();
        const hasNum = numbers.some((n) => {
          const variants = getNumberVariants(n);
          return variants.some((v) => sentLower.includes(v.toLowerCase()));
        });
        const hasConcept = conceptWords.length === 0 || conceptWords.some((w) => sentLower.includes(w));
        if (hasNum && hasConcept && sentence.length > 20) {
          score += 200; // Strong co-occurrence bonus
          addPassage(sentence);
        }
      }
    }

    // ─── TIER 3: N-gram / phrase matching ───
    if (contentWords.length >= 2) {
      const bigrams = generateNgrams(contentWords, 2);
      for (const bigram of bigrams) {
        if (contentLower.includes(bigram)) {
          score += 80;
          if (matchType === "keyword") matchType = "phrase";
        }
      }
      if (contentWords.length >= 3) {
        const trigrams = generateNgrams(contentWords, 3);
        for (const trigram of trigrams) {
          if (contentLower.includes(trigram)) {
            score += 150;
            matchType = "phrase";
          }
        }
      }
    }

    // ─── TIER 4: Proximity scoring ───
    const proxScore = proximityScore(contentLower, queryWords);
    score += proxScore;

    // ─── TIER 5: Individual keyword matching (with IDF-like weighting) ───
    let wordMatches = 0;
    for (const word of queryWords) {
      if (word.length === 0) continue;
      try {
        const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
        const matches = page.content.match(regex);
        if (matches) {
          // Longer words get higher weight (IDF approximation)
          const weight = Math.min(word.length * 2, 15);
          score += matches.length * weight;
          wordMatches++;
        }
      } catch {
        if (contentLower.includes(word)) {
          score += 5;
          wordMatches++;
        }
      }
    }

    // Bonus for matching ALL query words
    if (queryWords.length > 1 && wordMatches === queryWords.length) {
      score += 100;
    }

    // ─── TIER 6: Title match bonus ───
    const titleLower = page.title.toLowerCase();
    if (titleLower.includes(queryLower)) {
      score += 200;
    } else if (queryWords.some((w) => titleLower.includes(w))) {
      score += 30;
    }

    // ─── Extract best matching passages if we don't have any yet ───
    if (matchedPassages.length === 0 && score > 0) {
      // Find sentences with the most query word matches
      const sentenceScores = sentences.map((s) => {
        const sLower = s.toLowerCase();
        let sScore = 0;
        for (const w of queryWords) {
          if (sLower.includes(w)) sScore += 10;
        }
        for (const n of numbers) {
          if (sLower.includes(n)) sScore += 20;
        }
        return { sentence: s, sScore };
      });
      sentenceScores.sort((a, b) => b.sScore - a.sScore);
      for (const ss of sentenceScores.slice(0, 6)) {
        if (ss.sScore > 0) addPassage(ss.sentence);
      }
    }

    // If still no passages but there was a score, show context around first keyword hit
    if (matchedPassages.length === 0 && score > 0) {
      const firstWordIdx = queryWords.reduce((best, w) => {
        const idx = contentLower.indexOf(w);
        return idx >= 0 && (best < 0 || idx < best) ? idx : best;
      }, -1);
      if (firstWordIdx >= 0) {
        const start = Math.max(0, firstWordIdx - 100);
        const end = Math.min(page.content.length, firstWordIdx + 400);
        addPassage((start > 0 ? "..." : "") + page.content.substring(start, end) + (end < page.content.length ? "..." : ""));
      }
    }

    return { page, matchedPassages: matchedPassages.slice(0, 8), score, matchType };
  });

  return scored.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

interface UploadedDoc {
  name: string;
  size: string;
  status: "indexed" | "indexing" | "queued" | "error";
  pages?: number;
  errorMsg?: string;
}

interface ParsedPage {
  pageNum: number;
  title: string;
  content: string;
  docName: string;
}

interface ParsedQuestion {
  id: number;
  text: string;
  options: string[];
  correct: number;
  topic: string;
  explanation: string;
}

interface Flashcard {
  id: number;
  q: string;
  a: string;
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard";
}

interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

interface MindMapData {
  central: string;
  branches: MindMapNode[];
}
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tutorMode?: TutorMode;
  layers?: {
    grounded?: { text: string; page: number; paragraph: number; section: string; confidence: number; docName: string };
    web?: { text: string; sources: { title: string; url: string }[] };
    multimedia?: { diagram?: string; videoTitle?: string; videoTimestamp?: string; videoUrl?: string; table?: { headers: string[]; rows: string[][] } };
  };
  timestamp: Date;
}

type LeftTab = "study" | "paper" | "notes" | "flashcards" | "mindmap";
type RightTab = "chat" | "exam" | "analytics" | "revision" | "planner" | "graph";
type TutorMode = "beginner" | "exam" | "stepwise" | "hindi" | "hinglish";
type ExamMode = "practice" | "simulation";

const SUPPORTED_EXAMS = [
  "UPSC CSE", "SSC CGL", "SSC CHSL", "Banking (IBPS PO)", "Banking (SBI PO)",
  "Railway (RRB NTPC)", "GATE", "UGC NET", "JEE Mains", "JEE Advanced",
  "NEET", "State PCS", "CTET", "CLAT", "CAT", "NDA", "CDS", "Other",
];

// ══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════

function Badge({ children, color = "slate", className = "" }: { children: React.ReactNode; color?: string; className?: string }) {
  const colors: Record<string, string> = {
    slate: "bg-white/8/80 text-white/65 border-white/10/50",
    neutral: "bg-white/8/80 text-white/65 border-white/10/50",
    amber: "bg-gold/10 text-gold border-gold/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    sky: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    gold: "bg-gold/10 text-gold border-gold/20",
  };
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${colors[color] || colors.slate} ${className}`}>{children}</span>;
}

function EmptyState({ icon: Icon, title, description, action, onAction }: { icon: LucideIcon; title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
      <div className="mx-auto flex h-18 w-18 items-center justify-center rounded-3xl glass mb-6" style={{ border: '1px solid rgba(212,175,55,0.1)' }}>
        <Icon className="h-8 w-8 text-gold/50" />
      </div>
      <h3 className="text-[15px] font-semibold text-white/90 mb-2 tracking-tight">{title}</h3>
      <p className="text-[12px] text-white/35 max-w-[280px] leading-relaxed">{description}</p>
      {action && onAction && (
        <button onClick={onAction} className="mt-6 flex items-center gap-2 rounded-2xl btn-premium px-5 py-2.5 text-[12px] font-medium">
          <Upload className="h-3.5 w-3.5" />{action}
        </button>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: string; color: string }) {
  const border = { amber: "border-gold/15", emerald: "border-emerald-500/15", rose: "border-rose-500/15" }[color] || "border-white/10/30";
  const iconColor = { amber: "text-gold", emerald: "text-emerald-400", rose: "text-rose-400" }[color] || "text-white/65";
  return (
    <div className={`rounded-2xl border ${border} glass p-3 text-center`}>
      <Icon className={`mx-auto mb-1 h-5 w-5 ${iconColor}`} />
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] text-white/50">{label}</p>
    </div>
  );
}

// ── Rich Text Renderer (ChatGPT/Claude style) ────────────────
function FormattedText({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    const ListTag = listBuffer.type === "ol" ? "ol" : "ul";
    elements.push(
      <ListTag key={`list-${elements.length}`} className={`my-2 space-y-1 ${listBuffer.type === "ol" ? "list-decimal" : "list-disc"} pl-5`}>
        {listBuffer.items.map((item, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed text-white/75">
            <InlineFormat text={item} />
          </li>
        ))}
      </ListTag>
    );
    listBuffer = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      flushList();
      elements.push(<div key={`br-${i}`} className="h-2" />);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed) || /^___+$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={`hr-${i}`} className="my-3 border-white/8" />);
      continue;
    }

    // Headers
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(<h4 key={`h4-${i}`} className="text-[12.5px] font-bold text-gold-light mt-3 mb-1 flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-gold" /><InlineFormat text={trimmed.slice(4)} /></h4>);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(<h3 key={`h3-${i}`} className="text-[13px] font-bold text-white mt-3 mb-1"><InlineFormat text={trimmed.slice(3)} /></h3>);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(<h2 key={`h2-${i}`} className="text-sm font-bold text-white mt-2 mb-1"><InlineFormat text={trimmed.slice(2)} /></h2>);
      continue;
    }

    // Bullet list items
    const bulletMatch = trimmed.match(/^[•\-\*]\s+(.*)/);
    if (bulletMatch) {
      if (!listBuffer || listBuffer.type !== "ul") { flushList(); listBuffer = { type: "ul", items: [] }; }
      listBuffer.items.push(bulletMatch[1]);
      continue;
    }

    // Numbered list items
    const numMatch = trimmed.match(/^(\d+)[.)\-]\s+(.*)/);
    if (numMatch) {
      if (!listBuffer || listBuffer.type !== "ol") { flushList(); listBuffer = { type: "ol", items: [] }; }
      listBuffer.items.push(numMatch[2]);
      continue;
    }

    // Section header style (text ending with colon that's short)
    if (trimmed.endsWith(":") && trimmed.length < 80 && !trimmed.includes(".")) {
      flushList();
      elements.push(<p key={`sh-${i}`} className="text-[12.5px] font-semibold text-gold-light mt-3 mb-0.5"><InlineFormat text={trimmed} /></p>);
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(<p key={`p-${i}`} className="text-[12.5px] leading-relaxed text-white/75"><InlineFormat text={trimmed} /></p>);
  }
  flushList();

  return <div className={`space-y-0.5 ${className}`}>{elements}</div>;
}

// Inline formatter for bold, italic, code, highlights
function InlineFormat({ text }: { text: string }) {
  // Process **bold**, *italic*, `code`, and __underline__
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|__(.+?)__)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    if (match[2]) {
      // **bold**
      parts.push(<strong key={`b-${match.index}`} className="font-semibold text-white">{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      parts.push(<em key={`i-${match.index}`} className="italic text-white/85">{match[3]}</em>);
    } else if (match[4]) {
      // `code`
      parts.push(<code key={`c-${match.index}`} className="rounded bg-white/10/60 px-1.5 py-0.5 font-mono text-[11px] text-gold-light">{match[4]}</code>);
    } else if (match[5]) {
      // __underline__
      parts.push(<span key={`u-${match.index}`} className="underline decoration-gold/40 underline-offset-2">{match[5]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return <>{parts.length > 0 ? parts : text}</>;
}

// ══════════════════════════════════════════════════════════════
// OLLAMA LLM — Streaming local AI (no rate limits, fast)
// ══════════════════════════════════════════════════════════════

const OLLAMA_BASE = process.env.NEXT_PUBLIC_OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.NEXT_PUBLIC_OLLAMA_MODEL || "qwen2.5:1.5b";

// Warm up model — pre-loads it into RAM so first real query is fast
async function warmupModel(model: string): Promise<void> {
  try {
    console.log(`[PrepAI] Warming up model: ${model}`);
    await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
        options: { num_predict: 1, num_ctx: 128 },
      }),
    });
    console.log(`[PrepAI] Model ${model} warmed up successfully`);
  } catch (e) {
    console.warn(`[PrepAI] Warmup failed (non-critical):`, e);
  }
}

// Streaming API — tokens arrive word-by-word for better UX on slow hardware
async function streamOllamaResponse(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  onToken: (token: string) => void
): Promise<string> {
  const url = `${OLLAMA_BASE}/api/chat`;

  console.log(`[PrepAI] Streaming: model=${model}, system=${systemPrompt.length}chars, user=${userPrompt.length}chars`);

  const controller = new AbortController();
  // 5-minute absolute timeout for the entire request
  const absoluteTimeout = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        options: {
          temperature: 0.4,
          num_ctx: 2048,
          num_predict: 256,
          top_p: 0.9,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Ollama error (${response.status}): ${errBody.substring(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response stream from Ollama");

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";
    let gotFirstToken = false;

    // 60-second timeout for first token (model loading + prompt processing)
    const firstTokenTimeout = setTimeout(() => {
      if (!gotFirstToken) {
        console.warn("[PrepAI] No first token after 60s — aborting");
        controller.abort();
      }
    }, 60000);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.done) continue;
          const token = parsed.message?.content || "";
          if (token) {
            if (!gotFirstToken) {
              gotFirstToken = true;
              clearTimeout(firstTokenTimeout);
              console.log(`[PrepAI] First token received`);
            }
            fullText += token;
            onToken(token);
          }
        } catch { /* skip malformed JSON lines */ }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        const token = parsed.message?.content || "";
        if (token) { fullText += token; onToken(token); }
      } catch { /* skip */ }
    }

    clearTimeout(absoluteTimeout);
    clearTimeout(firstTokenTimeout);
    console.log(`[PrepAI] Stream complete: ${fullText.length} chars`);
    return fullText;
  } catch (err: any) {
    clearTimeout(absoluteTimeout);
    if (err.name === "AbortError") {
      throw new Error("Model is too slow for your hardware. Try: ollama pull qwen2.5:0.5b");
    }
    if (err.message?.includes("Failed to fetch") || err.message?.includes("NetworkError")) {
      throw new Error("Cannot connect to Ollama. Run 'ollama serve' in your terminal.");
    }
    throw err;
  }
}

async function checkOllamaConnection(): Promise<{ connected: boolean; models: string[] }> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { connected: false, models: [] };
    const data = await res.json();
    const models = (data.models || []).map((m: any) => m.name);
    return { connected: true, models };
  } catch {
    return { connected: false, models: [] };
  }
}

// ══════════════════════════════════════════════════════════════
// ChatGPT/Claude-Style Answer Pipeline
// ══════════════════════════════════════════════════════════════

function buildSystemPrompt(tutorMode: string, examType: string): string {
  const modeHint: Record<string, string> = {
    beginner: "IMPORTANT: The student is a COMPLETE BEGINNER. Use very simple language. Define EVERY technical term. Use daily-life analogies. Example: 'DNA is like a recipe book that tells your body how to work.'",
    exam: "The student is preparing for EXAMS. Focus on key formulas, definitions, facts, mnemonics. Add a '⭐ Key Points for Exam' section at the end.",
    stepwise: "IMPORTANT: Use STEP-BY-STEP numbered format for EVERYTHING. Step 1: ... Step 2: ... Explain WHY each step is done.",
    hindi: "CRITICAL: You MUST respond ENTIRELY in Hindi (Devanagari script हिंदी में). DO NOT write in English. Only technical terms can stay English. Example response: 'DNA एक अणु है जो सभी जीवित प्राणियों में आनुवंशिक जानकारी रखता है। यह कोशिका के केन्द्रक में पाया जाता है।' RESPOND LIKE THIS IN HINDI.",
    hinglish: "CRITICAL: You MUST respond in HINGLISH (Roman Hindi mixed with English). Example: 'DNA ek molecule hai jo sabhi living organisms mein genetic information store karta hai. Ye cell ke nucleus mein hota hai.' RESPOND LIKE THIS IN HINGLISH.",
  };

  const langDirective = modeHint[tutorMode] || modeHint.exam;

  return `${langDirective}

You are a world-class ${examType} tutor.

RULES:
1. Start with a DIRECT 1-2 sentence answer
2. Use ONLY the document content in <context> tags — do NOT make up information
3. Cite page numbers like (Page 5)
4. Use markdown: **bold** key terms, numbered lists for steps, bullet points for key takeaways
5. For experiments: organize as Aim, Apparatus, Procedure (numbered steps), Observations, Conclusion, Key Points
6. For concepts: organize as Definition, Explanation, Formula, Example, Key Points
7. Be thorough and detailed — write like an expert teacher explaining face-to-face
8. If the topic is not in the documents, say so clearly`;
}

// Context builder — sends full page content with clear delimiters
function buildUserPrompt(
  query: string,
  pages: { pageNum: number; content: string; docName: string }[]
): string {
  // Cap at 1500 chars per page and max 2 pages to stay within small context window
  const contextChunks = pages.slice(0, 2).map((p) =>
    `[Source: ${p.docName}, Page ${p.pageNum}]\n${p.content.substring(0, 1500)}`
  ).join("\n\n---\n\n");

  return `<context>\n${contextChunks}\n</context>\n\nQuestion: ${query}\n\nAnswer thoroughly using the document content above. Start with a direct answer, then explain in detail with proper structure.`;
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

export default function ExamCopilot() {
  // ── General ──────────────────────────────────────────────
  const [selectedExam, setSelectedExam] = useState("UPSC CSE");
  const [showExamSelector, setShowExamSelector] = useState(false);

  // ── Ollama LLM ─────────────────────────────────────────────
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [ollamaModel, setOllamaModel] = useState(OLLAMA_MODEL);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // Check Ollama connection on mount + warm up model
  useEffect(() => {
    checkOllamaConnection().then(({ connected, models }) => {
      setOllamaStatus(connected ? "connected" : "disconnected");
      if (models.length > 0) setAvailableModels(models);
      // Auto-select first available model if configured one isn't available
      if (connected && models.length > 0 && !models.includes(OLLAMA_MODEL)) {
        setOllamaModel(models[0]);
      }
      // Warm up the model — pre-load into RAM for faster first response
      if (connected) {
        const modelToWarm = models.includes(OLLAMA_MODEL) ? OLLAMA_MODEL : models[0];
        if (modelToWarm) warmupModel(modelToWarm);
      }
    });
  }, []);

  // ── Panel & Tab ──────────────────────────────────────────
  const [leftTab, setLeftTab] = useState<LeftTab>("study");
  const [rightTab, setRightTab] = useState<RightTab>("chat");

  // ── Document state ───────────────────────────────────────
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Parsed content from uploads ──────────────────────────
  const [parsedPages, setParsedPages] = useState<ParsedPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [highlightedSection, setHighlightedSection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Question paper state ─────────────────────────────────
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[]>([]);

  // ── AI Notes ─────────────────────────────────────────────
  const [generatedNotes, setGeneratedNotes] = useState<string>("");

  // ── Flashcards ───────────────────────────────────────────
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [flashFilter, setFlashFilter] = useState<"all" | "Easy" | "Medium" | "Hard">("all");
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());

  // ── Chat ─────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "sys", role: "system", content: "Welcome to PrepAI Copilot! Drop your study materials here for private, document-grounded AI learning.", timestamp: new Date() },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [tutorMode, setTutorMode] = useState<TutorMode>("exam");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Exam engine ──────────────────────────────────────────
  const [examMode, setExamMode] = useState<ExamMode>("practice");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());
  const [examTimer, setExamTimer] = useState(3600);
  const [examStarted, setExamStarted] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [expandedExp, setExpandedExp] = useState<number | null>(null);
  const [negativeMarking, setNegativeMarking] = useState(0.25);

  // ── Mind map ─────────────────────────────────────────────
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [mindMapData, setMindMapData] = useState<MindMapData | null>(null);

  // ── Knowledge graph ──────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // ── Generation loading states ───────────────────────────
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [generatingMindMap, setGeneratingMindMap] = useState(false);

  // ── Agent ────────────────────────────────────────────────
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentSteps, setAgentSteps] = useState<{ step: string; status: "done" | "running" | "pending" }[]>([]);

  // ── Analytics (tracked from user activity) ───────────────
  const [examHistory, setExamHistory] = useState<{ correct: number; wrong: number; total: number; date: string }[]>([]);

  // Derived
  const hasDocuments = uploadedDocs.some((d) => d.status === "indexed");
  const filteredFlashcards = useMemo(() => flashFilter === "all" ? flashcards : flashcards.filter((f) => f.difficulty === flashFilter), [flashFilter, flashcards]);
  const questionObj = parsedQuestions[currentQuestion];

  // ── Search filtering for document viewer ─────────────────
  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return parsedPages;
    return parsedPages.filter((p) =>
      p.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [parsedPages, searchQuery]);

  const displayPages = filteredPages.length > 0 ? filteredPages : parsedPages;
  const currentPageData = displayPages[currentPage] || null;

  // ── Timer ────────────────────────────────────────────────
  useEffect(() => {
    if (examMode === "simulation" && examStarted && !examSubmitted && examTimer > 0) {
      const iv = setInterval(() => setExamTimer((p) => { if (p <= 1) { setExamSubmitted(true); return 0; } return p - 1; }), 1000);
      return () => clearInterval(iv);
    }
  }, [examMode, examStarted, examSubmitted, examTimer]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping]);

  // ── Deep link ────────────────────────────────────────────
  const handleDeepLink = useCallback((pageNum: number) => {
    const idx = parsedPages.findIndex((p) => p.pageNum === pageNum);
    if (idx >= 0) setCurrentPage(idx);
    setLeftTab("study");
    setSearchQuery("");
    setHighlightedSection("full-page");
    setTimeout(() => setHighlightedSection(null), 3000);
  }, [parsedPages]);

  // ── File upload — REAL PDF extraction ─────────────────────
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const docName = file.name;
      const sizeStr = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

      // Add as queued
      setUploadedDocs((prev) => [...prev, { name: docName, size: sizeStr, status: "queued" }]);

      // Start indexing
      setUploadedDocs((prev) => prev.map((d) => d.name === docName && d.status === "queued" ? { ...d, status: "indexing" } : d));

      try {
        if (file.name.toLowerCase().endsWith(".pdf")) {
          // Real PDF text extraction
          const result = await extractPdfText(file);
          const newPages: ParsedPage[] = result.pages.map((p) => ({
            pageNum: p.pageNum,
            title: `${docName} — Page ${p.pageNum}`,
            content: preprocessDocumentText(p.text),
            docName: docName,
          }));
          setParsedPages((prev) => [...prev, ...newPages]);
          setUploadedDocs((prev) => prev.map((d) => d.name === docName && d.status === "indexing" ? { ...d, status: "indexed", pages: result.totalPages } : d));
        } else if (file.name.toLowerCase().endsWith(".txt")) {
          // Text file
          const text = await extractTextFromTxt(file);
          const chunks = text.match(/[\s\S]{1,2000}/g) || [text];
          const newPages: ParsedPage[] = chunks.map((chunk, i) => ({
            pageNum: i + 1,
            title: `${docName} — Section ${i + 1}`,
            content: chunk.trim(),
            docName: docName,
          }));
          setParsedPages((prev) => [...prev, ...newPages]);
          setUploadedDocs((prev) => prev.map((d) => d.name === docName && d.status === "indexing" ? { ...d, status: "indexed", pages: chunks.length } : d));
        } else {
          // For other formats, read as text (best effort)
          try {
            const text = await extractTextFromTxt(file);
            if (text.trim().length > 20) {
              const chunks = text.match(/[\s\S]{1,2000}/g) || [text];
              const newPages: ParsedPage[] = chunks.map((chunk, i) => ({
                pageNum: i + 1,
                title: `${docName} — Section ${i + 1}`,
                content: chunk.trim(),
                docName: docName,
              }));
              setParsedPages((prev) => [...prev, ...newPages]);
              setUploadedDocs((prev) => prev.map((d) => d.name === docName && d.status === "indexing" ? { ...d, status: "indexed", pages: chunks.length } : d));
            } else {
              setUploadedDocs((prev) => prev.map((d) => d.name === docName && d.status === "indexing" ? { ...d, status: "error", errorMsg: "Could not extract text. Try PDF or TXT format." } : d));
            }
          } catch {
            setUploadedDocs((prev) => prev.map((d) => d.name === docName && d.status === "indexing" ? { ...d, status: "error", errorMsg: "Unsupported format. Please use PDF or TXT." } : d));
          }
        }
      } catch (err) {
        console.error("PDF extraction error:", err);
        setUploadedDocs((prev) => prev.map((d) => d.name === docName && d.status === "indexing" ? { ...d, status: "error", errorMsg: "Failed to extract text. The PDF may be image-based or corrupted." } : d));
      }
    }
  }, []);

  const removeDoc = useCallback((name: string) => {
    setUploadedDocs((prev) => prev.filter((d) => d.name !== name));
  }, []);

  // ── Chat send — STREAMING Ollama RAG Pipeline ─────────────
  const sendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: chatInput, tutorMode, timestamp: new Date() };
    setMessages((p) => [...p, userMsg]);
    const query = chatInput;
    setChatInput("");
    setIsTyping(true);

    try {
      if (!hasDocuments || parsedPages.length === 0) {
        setIsTyping(false);
        setMessages((p) => [...p, {
          id: `a-${Date.now()}`, role: "assistant",
          content: "Please upload your study documents first. Click the upload button to get started.",
          timestamp: new Date(),
        }]);
        return;
      }

      // STEP 1: Fast retrieval (~1ms)
      const pagesWithDoc = parsedPages.map((p) => ({ ...p, docName: p.docName || "Unknown Document" }));
      const results = searchDocuments(query, pagesWithDoc);
      const topResults = results.slice(0, 3);

      const ytQuery = encodeURIComponent(`${query} ${selectedExam} explanation`);
      const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;
      const googleQuery = encodeURIComponent(`${query} ${selectedExam}`);

      // STEP 2: Stream from Ollama with FULL page content
      if (ollamaStatus === "connected" && (topResults.length > 0 || parsedPages.length > 0)) {
        // Build context: full pages, not fragments
        const contextPages: { pageNum: number; content: string; docName: string }[] = [];
        const addedPages = new Set<number>();

        if (topResults.length > 0) {
          // Add top result as full page (limit to 1 for speed)
          const r = topResults[0];
          if (!addedPages.has(r.page.pageNum)) {
            contextPages.push({ pageNum: r.page.pageNum, content: r.page.content, docName: r.page.docName });
            addedPages.add(r.page.pageNum);
          }
          // Add ONE neighboring page for context continuity
          const topPageNum = topResults[0].page.pageNum;
          for (const p of parsedPages) {
            if (!addedPages.has(p.pageNum) && Math.abs(p.pageNum - topPageNum) === 1 && contextPages.length < 2) {
              contextPages.push({ pageNum: p.pageNum, content: p.content, docName: p.docName || "Document" });
              break;
            }
          }
          // Sort by page number for natural reading order
          contextPages.sort((a, b) => a.pageNum - b.pageNum);
        } else {
          // No search results — send first 3 pages
          for (const p of parsedPages.slice(0, 2)) {
            contextPages.push({ pageNum: p.pageNum, content: p.content, docName: p.docName || "Document" });
          }
        }

        const systemPrompt = buildSystemPrompt(tutorMode, selectedExam);
        const userPrompt = buildUserPrompt(query, contextPages);

        // Prepare layers for the response message
        const topPage = contextPages[0];
        const layers = {
          grounded: {
            text: `## Source Documents\n\n${contextPages.map((p, i) => `${i + 1}. **${p.docName}** — Page ${p.pageNum}`).join("\n")}`,
            page: topPage.pageNum,
            paragraph: 1,
            section: topPage.docName,
            confidence: 0.95,
            docName: topPage.docName,
          },
          web: {
            text: `More resources:`,
            sources: [
              { title: `Google: "${query} ${selectedExam}"`, url: `https://www.google.com/search?q=${googleQuery}` },
              { title: `YouTube: "${query}"`, url: ytUrl },
            ],
          },
        };

        // Stream response — tokens appear word-by-word
        console.log(`[PrepAI] Sending ${contextPages.length} pages to ${ollamaModel}`);
        
        const aiMsgId = `a-${Date.now()}`;
        // Create empty message, then stream tokens into it
        setIsTyping(false);
        setMessages((p) => [...p, {
          id: aiMsgId,
          role: "assistant",
          content: "",
          layers,
          timestamp: new Date(),
        }]);

        try {
          const fullResponse = await streamOllamaResponse(ollamaModel, systemPrompt, userPrompt, (token) => {
            setMessages((prev) => prev.map((m) =>
              m.id === aiMsgId ? { ...m, content: m.content + token } : m
            ));
          });

          // If stream returned empty, show fallback
          if (!fullResponse || fullResponse.trim().length === 0) {
            const fallbackContent = contextPages.map((p) => 
              `## Page ${p.pageNum} — ${p.docName}\n\n${p.content.substring(0, 1500)}`
            ).join("\n\n---\n\n");
            setMessages((prev) => prev.map((m) =>
              m.id === aiMsgId ? { ...m, content: `**No response from model.** Here is the document content:\n\n${fallbackContent}` } : m
            ));
          }
        } catch (streamErr) {
          console.error("[PrepAI] Stream error:", streamErr);
          const fallbackContent = contextPages.map((p) => 
            `## Page ${p.pageNum} — ${p.docName}\n\n${p.content.substring(0, 1500)}`
          ).join("\n\n---\n\n");
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? { ...m, content: (m.content ? m.content + "\n\n---\n\n" : "") + `**⚠️ ${streamErr instanceof Error ? streamErr.message : "Error"}**\n\n${fallbackContent}` } : m
          ));
        }
      } else if (topResults.length > 0) {
        // Fallback: Ollama not connected, show raw search results
        const top = topResults[0];
        const groundedText = top.matchedPassages.length > 0
          ? top.matchedPassages.slice(0, 5).map((p) => `- ${p.trim().substring(0, 300)}`).join("\n")
          : top.page.content.substring(0, 800);
        setIsTyping(false);
        setMessages((p) => [...p, {
          id: `a-${Date.now()}`, role: "assistant",
          content: `Found relevant content on Page ${top.page.pageNum}.\n\n${groundedText}`,
          layers: {
            grounded: { text: groundedText, page: top.page.pageNum, paragraph: 1, section: top.page.title, confidence: 0.7, docName: top.page.docName },
            web: { text: `Web resources:`, sources: [{ title: `Google: "${query}"`, url: `https://www.google.com/search?q=${googleQuery}` }] },
          },
          timestamp: new Date(),
        }]);
      } else {
        const hint = ollamaStatus !== "connected" ? " Start Ollama with 'ollama serve' for AI answers." : "";
        setIsTyping(false);
        setMessages((p) => [...p, {
          id: `a-${Date.now()}`, role: "assistant",
          content: `No matching content found for "${query}". Try rephrasing.${hint}`,
          timestamp: new Date(),
        }]);
      }
    } catch (err) {
      console.error("Chat error:", err);
      setIsTyping(false);
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      const hint = (errorMsg.includes("connect") || errorMsg.includes("Ollama"))
        ? " Run 'ollama serve' in your terminal, then 'ollama pull " + ollamaModel + "'."
        : " Please try again.";
      setMessages((p) => [...p, {
        id: `e-${Date.now()}`, role: "assistant",
        content: `**Error:** ${errorMsg}${hint}`,
        timestamp: new Date(),
      }]);
    }
  }, [chatInput, tutorMode, hasDocuments, uploadedDocs, selectedExam, parsedPages, ollamaStatus, ollamaModel]);

  // ── Helper: robustly extract and parse JSON from LLM response ──
  const extractJSON = (text: string): string | null => {
    // Step 1: Strip markdown code fences
    let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    
    // Step 2: Find balanced JSON using bracket counting
    const findBalanced = (str: string, open: string, close: string): string | null => {
      const start = str.indexOf(open);
      if (start === -1) return null;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = start; i < str.length; i++) {
        const ch = str[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"' && !escape) { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth++;
        if (ch === close) depth--;
        if (depth === 0) return str.substring(start, i + 1);
      }
      // If unbalanced, try adding closing bracket
      return str.substring(start) + close;
    };

    // Step 3: Try array first, then object
    let jsonStr = findBalanced(cleaned, "[", "]") || findBalanced(cleaned, "{", "}");
    if (!jsonStr) return null;

    // Step 4: Clean common LLM JSON errors
    jsonStr = jsonStr
      .replace(/,\s*([}\]])/g, "$1")           // Remove trailing commas
      .replace(/[\x00-\x1F\x7F]/g, " ")        // Remove control characters
      .replace(/\n/g, " ")                       // Flatten newlines inside strings
      .replace(/"\s*\n\s*"/g, '""')             // Fix split strings
      .trim();

    return jsonStr;
  };

  // Safe JSON parse with multiple fallback strategies
  const safeParseJSON = (text: string): any | null => {
    const jsonStr = extractJSON(text);
    if (!jsonStr) return null;
    
    // Try 1: Direct parse
    try { return JSON.parse(jsonStr); } catch {}
    
    // Try 2: Fix common issues and retry
    try {
      const fixed = jsonStr
        .replace(/'/g, '"')                      // Single to double quotes
        .replace(/(\w+):/g, '"$1":')             // Unquoted keys
        .replace(/,\s*([}\]])/g, "$1");          // Trailing commas again
      return JSON.parse(fixed);
    } catch {}
    
    // Try 3: Extract individual objects from broken array
    try {
      const objects: any[] = [];
      const objRegex = /\{[^{}]*\}/g;
      let match;
      while ((match = objRegex.exec(text)) !== null) {
        try {
          objects.push(JSON.parse(match[0].replace(/'/g, '"')));
        } catch {}
      }
      if (objects.length > 0) return objects;
    } catch {}
    
    console.warn("[PrepAI] Could not parse JSON from LLM response:", jsonStr.substring(0, 200));
    return null;
  };

  // ── Helper: get document context for generation ─────────
  const getDocContext = (maxPages = 3, maxCharsPerPage = 1200): string => {
    return parsedPages.slice(0, maxPages).map((p) =>
      `[Page ${p.pageNum}]\n${p.content.substring(0, maxCharsPerPage)}`
    ).join("\n\n---\n\n");
  };

  // ── Tutor mode: strong system prefix (placed FIRST in system prompt) ──
  const getTutorSystemPrefix = (mode: TutorMode): string => {
    const prefixes: Record<TutorMode, string> = {
      beginner: "IMPORTANT: You are teaching a COMPLETE BEGINNER. Use very simple words. Define EVERY technical term in simple language. Use analogies from daily life.",
      exam: "You are an exam preparation expert. Focus on key facts, formulas, mnemonics, and frequently tested points.",
      stepwise: "IMPORTANT: Use NUMBERED STEPS for everything. Format: Step 1: ... Step 2: ... Explain WHY each step matters.",
      hindi: "CRITICAL INSTRUCTION: You MUST respond ENTIRELY in Hindi (Devanagari script हिंदी में). DO NOT use English for explanations. Only technical terms like 'photosynthesis' can stay English. Example: 'प्रकाश संश्लेषण एक प्रक्रिया है जिसमें पौधे सूर्य के प्रकाश का उपयोग करते हैं।' WRITE EVERYTHING IN HINDI LIKE THIS.",
      hinglish: "CRITICAL INSTRUCTION: You MUST respond in HINGLISH (Hindi + English mix). Write in Roman Hindi script mixed with English. Example: 'Photosynthesis ek process hai jisme plants sunlight ka use karke food banate hain. Isme CO2 aur water use hota hai.' WRITE EVERYTHING IN HINGLISH LIKE THIS.",
    };
    return prefixes[mode] || prefixes.exam;
  };

  // ── Tutor mode hint for generation (feature-specific) ──
  const getTutorHint = (mode: TutorMode, context: "notes" | "flashcards" | "questions" | "mindmap"): string => {
    const hints: Record<TutorMode, Record<string, string>> = {
      beginner: {
        notes: "Use SIMPLE language a 10-year-old can understand. Define every term. Example: 'Photosynthesis = how plants make food using sunlight'. Use ✅ and ❌ for dos/donts.",
        flashcards: "Make EASY questions. Example Q: 'What is photosynthesis?' A: 'It is how plants make food using sunlight and water.' Use simple words only.",
        questions: "Make EASY questions. All options should be clearly different. No tricky language. Test basic recall only.",
        mindmap: "Use simple everyday words. No jargon. Example: 'How Plants Make Food' instead of 'Photosynthesis'.",
      },
      exam: {
        notes: "Focus on KEY FORMULAS, definitions, mnemonics. Add ⭐ for frequently asked. Include 'Key Points for Exam' section at the end with bullet points.",
        flashcards: "Test exam-critical facts, formulas, dates, and definitions. Add mnemonics where possible.",
        questions: "Create exam-pattern MCQs with tricky but fair distractors. Test deep understanding.",
        mindmap: "Highlight exam-important topics. Mark frequently tested areas.",
      },
      stepwise: {
        notes: "Format EVERYTHING as numbered steps:\n\nStep 1: [action] — [why this matters]\nStep 2: [action] — [why this matters]\n\nBreak every concept into a clear procedure.",
        flashcards: "Ask process questions. Example Q: 'What is Step 3 in photosynthesis?' A: 'CO2 is fixed by RuBisCO enzyme in Calvin cycle.'",
        questions: "Ask about sequences and procedures. Example: 'What happens AFTER the light reaction?' Test step ordering.",
        mindmap: "Show process flows. Label: 'Step 1 → Step 2 → Step 3'. Use arrows in labels.",
      },
      hindi: {
        notes: "सभी नोट्स हिंदी (देवनागरी) में लिखें। Technical terms English में रख सकते हैं लेकिन explanation पूरा Hindi में। Example: '## प्रकाश संश्लेषण\n\n**प्रकाश संश्लेषण** वह प्रक्रिया है जिसमें पौधे सूर्य के प्रकाश, जल और CO2 का उपयोग करके भोजन बनाते हैं।'",
        flashcards: "प्रश्न और उत्तर हिंदी में लिखें। Example q: 'प्रकाश संश्लेषण क्या है?' a: 'यह वह प्रक्रिया है जिसमें पौधे सूर्य के प्रकाश से भोजन बनाते हैं।'",
        questions: "प्रश्न और सभी विकल्प हिंदी में लिखें। Example: text: 'प्रकाश संश्लेषण किसमें होता है?' options: ['A) पत्तियों में', 'B) जड़ों में', 'C) तने में', 'D) फूलों में']",
        mindmap: "लेबल हिंदी में। Example: 'प्रकाश संश्लेषण' instead of 'Photosynthesis'. Technical terms English में रख सकते हैं।",
      },
      hinglish: {
        notes: "Notes HINGLISH mein likho (Roman Hindi + English). Example: '## Photosynthesis Kya Hai?\n\nPhotosynthesis ek aisi process hai jisme plants sunlight, water aur CO2 use karke apna food banate hain. Ye mainly **leaves** mein hoti hai.'",
        flashcards: "Hinglish mein likho. Example q: 'Photosynthesis kya hai?' a: 'Ye ek process hai jisme plants sunlight se food banate hain. Isme chlorophyll important role play karta hai.'",
        questions: "Hinglish mein likho. Example: text: 'Photosynthesis kis part mein hoti hai?' options: ['A) Leaves mein', 'B) Roots mein', 'C) Stem mein', 'D) Flowers mein']",
        mindmap: "Hinglish mein labels. Example: 'Plants ka Food Making Process' ya 'Photosynthesis Kya Hai'.",
      },
    };
    return hints[mode]?.[context] || hints.exam[context];
  };

  // ── Exam-specific question style ────────────────────────
  const getExamStyle = (exam: string): string => {
    const styles: Record<string, string> = {
      "UPSC CSE": "Create UPSC CSE style analytical MCQs. Use 'Consider the following statements: (1)... (2)... Which of the above is/are correct?' pattern. Include 'Both 1 and 2', 'Neither 1 nor 2' type options.",
      "SSC CGL": "Create SSC CGL style direct factual MCQs. Short, crisp questions testing GK, reasoning, and quick recall.",
      "SSC CHSL": "Create SSC CHSL pattern MCQs. Simple, direct questions on basic concepts and facts.",
      "Banking (IBPS PO)": "Create Banking exam style questions. Include reasoning, quantitative aptitude, and general awareness patterns.",
      "Banking (SBI PO)": "Create SBI PO pattern questions with data interpretation and logical reasoning focus.",
      "Railway (RRB NTPC)": "Create Railway exam MCQs. Mix of GK, science, math, and reasoning. Moderate difficulty.",
      "GATE": "Create GATE-level technical MCQs. Include formula-based problems and numerical answer type questions. High difficulty.",
      "UGC NET": "Create UGC NET style questions testing research aptitude and higher education concepts.",
      "JEE Mains": "Create JEE Mains style MCQs. Include numerical problems, formula application, and conceptual physics/chemistry/math questions.",
      "JEE Advanced": "Create JEE Advanced level questions. Complex multi-concept problems. Include 'more than one correct' style.",
      "NEET": "Create NEET-style biology/chemistry/physics MCQs. NCERT-aligned, concept-based questions.",
      "CAT": "Create CAT-style questions focusing on logical reasoning, data interpretation, and verbal ability.",
      "CLAT": "Create CLAT-style legal reasoning and English comprehension questions.",
      "NDA": "Create NDA exam pattern MCQs covering math, GK, English, and science.",
      "CDS": "Create CDS exam pattern questions on GK, math, and English.",
    };
    return styles[exam] || "Create standard competitive exam style MCQs appropriate for the content.";
  };


  // ── Generate AI Notes ───────────────────────────────────
  const generateNotes = useCallback(async () => {
    if (!hasDocuments || generatingNotes) return;
    setGeneratingNotes(true);
    setGeneratedNotes("");
    try {
      const context = getDocContext(4, 1500);
      const modeHint = getTutorHint(tutorMode, "notes");
      const prompt = `Create comprehensive ${selectedExam} study notes from this content:\n\n${context}\n\n${modeHint}\n\nFormat as markdown with:\n- ## headings for main topics\n- **bold** key terms\n- Bullet points for key concepts\n- Important formulas\n- ⭐ marks for exam-important points\n\nBe thorough and cover all topics.`;
      
      const sysPrefix = getTutorSystemPrefix(tutorMode);
      await streamOllamaResponse(ollamaModel, `${sysPrefix} You are a ${selectedExam} study notes expert. ${modeHint}`, prompt, (token) => {
        setGeneratedNotes((prev) => prev + token);
      });
    } catch (err) {
      setGeneratedNotes("**Error generating notes:** " + (err instanceof Error ? err.message : "Unknown error") + "\n\nPlease try again.");
    }
    setGeneratingNotes(false);
  }, [hasDocuments, generatingNotes, parsedPages, ollamaModel, tutorMode, selectedExam]);

  // ── Generate Flashcards ─────────────────────────────────
  const generateFlashcards = useCallback(async () => {
    if (!hasDocuments || generatingFlashcards) return;
    setGeneratingFlashcards(true);
    try {
      const context = getDocContext(3, 1200);
      const modeHint = getTutorHint(tutorMode, "flashcards");
      const prompt = `Generate 8 ${selectedExam} flashcards from this content:\n\n${context}\n\n${modeHint}\n\nOutput ONLY a JSON array, no other text:\n[{"q":"question here","a":"answer here","topic":"topic name","difficulty":"Easy or Medium or Hard"}]`;
      
      let response = "";
      const sysPrefix = getTutorSystemPrefix(tutorMode);
      await streamOllamaResponse(ollamaModel, `${sysPrefix} You output only valid JSON arrays. No markdown, no explanation.`, prompt, (token) => {
        response += token;
      });
      
      const parsed = safeParseJSON(response);
      if (parsed && Array.isArray(parsed)) {
        setFlashcards(parsed.map((f: any, i: number) => ({
          id: i + 1,
          q: f.q || f.question || "Question",
          a: f.a || f.answer || "Answer",
          topic: f.topic || "General",
          difficulty: (["Easy", "Medium", "Hard"].includes(f.difficulty) ? f.difficulty : "Medium") as "Easy" | "Medium" | "Hard",
        })));
      } else {
        setFlashcards([{ id: 1, q: "Could not parse flashcards", a: response.substring(0, 500), topic: "Error", difficulty: "Medium" }]);
      }
    } catch (err) {
      setFlashcards([{ id: 1, q: "Error generating flashcards", a: (err instanceof Error ? err.message : "Unknown error"), topic: "Error", difficulty: "Medium" }]);
    }
    setGeneratingFlashcards(false);
  }, [hasDocuments, generatingFlashcards, parsedPages, ollamaModel, tutorMode, selectedExam]);

  // ── Generate Questions ──────────────────────────────────
  const generateQuestions = useCallback(async () => {
    if (!hasDocuments || generatingQuestions) return;
    setGeneratingQuestions(true);
    try {
      const context = getDocContext(3, 1200);
      const examStyle = getExamStyle(selectedExam);
      const modeHint = getTutorHint(tutorMode, "questions");
      const prompt = `Generate 5 ${selectedExam} multiple-choice questions from this content:\n\n${context}\n\n${examStyle}\n${modeHint}\n\nOutput ONLY a JSON array, no other text:\n[{"text":"question text","options":["A) option1","B) option2","C) option3","D) option4"],"correct":0,"topic":"topic","explanation":"why the answer is correct"}]\n\ncorrect is the index (0-3) of the right answer.`;
      
      let response = "";
      const sysPrefix = getTutorSystemPrefix(tutorMode);
      await streamOllamaResponse(ollamaModel, `${sysPrefix} You are a ${selectedExam} question paper setter. Output only valid JSON arrays.`, prompt, (token) => {
        response += token;
      });
      
      const parsed = safeParseJSON(response);
      if (parsed && Array.isArray(parsed)) {
        const questions: ParsedQuestion[] = parsed.map((q: any, i: number) => ({
          id: i + 1,
          text: q.text || q.question || "Question " + (i + 1),
          options: Array.isArray(q.options) ? q.options : ["A)", "B)", "C)", "D)"],
          correct: typeof q.correct === "number" ? q.correct : 0,
          topic: q.topic || "General",
          explanation: q.explanation || "See the document for details.",
        }));
        setParsedQuestions(questions);
        setCurrentQuestion(0);
        setSelectedAnswers({});
        setRevealedAnswers(new Set());
        setExamSubmitted(false);
      }
    } catch (err) {
      console.error("Question generation error:", err);
    }
    setGeneratingQuestions(false);
  }, [hasDocuments, generatingQuestions, parsedPages, ollamaModel, tutorMode, selectedExam]);

  // ── Generate Mind Map ───────────────────────────────────
  const generateMindMap = useCallback(async () => {
    if (!hasDocuments || generatingMindMap) return;
    setGeneratingMindMap(true);
    try {
      const context = getDocContext(3, 1200);
      const modeHint = getTutorHint(tutorMode, "mindmap");
      const prompt = `Create a ${selectedExam} mind map from this content:\n\n${context}\n\n${modeHint}\n\nOutput ONLY a JSON object, no other text:\n{"central":"Main Topic Name","branches":[{"label":"Branch 1","children":[{"label":"Sub-topic 1"},{"label":"Sub-topic 2"}]},{"label":"Branch 2","children":[{"label":"Sub-topic 3"}]}]}\n\nCreate 4-6 main branches with 2-3 children each. Use short labels (2-5 words).`;
      
      let response = "";
      const sysPrefix = getTutorSystemPrefix(tutorMode);
      await streamOllamaResponse(ollamaModel, `${sysPrefix} You output only valid JSON objects. No markdown, no explanation.`, prompt, (token) => {
        response += token;
      });
      
      const parsed = safeParseJSON(response);
      if (parsed && parsed.central && Array.isArray(parsed.branches)) {
        setMindMapData({
          central: parsed.central,
          branches: parsed.branches.map((b: any) => ({
            label: b.label || "Branch",
            children: Array.isArray(b.children) ? b.children.map((c: any) => ({
              label: typeof c === "string" ? c : c.label || "Node",
              children: Array.isArray(c.children) ? c.children.map((sc: any) => ({ label: typeof sc === "string" ? sc : sc.label || "Node" })) : undefined,
            })) : undefined,
          })),
        });
      }
    } catch (err) {
      console.error("Mind map generation error:", err);
    }
    setGeneratingMindMap(false);
  }, [hasDocuments, generatingMindMap, parsedPages, ollamaModel, tutorMode, selectedExam]);

  // ── Agent workflow (generates all content) ──────────────
  const runAgent = useCallback(async () => {
    if (!hasDocuments) { setShowUpload(true); return; }
    setAgentRunning(true);
    const steps = [
      "Reading uploaded documents...", "Generating study notes...",
      "Creating flashcards...", "Generating practice questions...",
      "Building mind map...", "Done!",
    ];
    setAgentSteps(steps.map((s) => ({ step: s, status: "pending" })));

    const updateStep = (idx: number, status: "running" | "done") => {
      setAgentSteps((prev) => prev.map((s, i) => i === idx ? { ...s, status } : i < idx ? { ...s, status: "done" } : s));
    };

    try {
      updateStep(0, "running");
      await new Promise((r) => setTimeout(r, 500)); // brief pause
      updateStep(0, "done");

      updateStep(1, "running");
      await generateNotes();
      updateStep(1, "done");

      updateStep(2, "running");
      await generateFlashcards();
      updateStep(2, "done");

      updateStep(3, "running");
      await generateQuestions();
      updateStep(3, "done");

      updateStep(4, "running");
      await generateMindMap();
      updateStep(4, "done");

      updateStep(5, "done");
    } catch (err) {
      console.error("Agent error:", err);
    }
    setAgentRunning(false);
  }, [hasDocuments, generateNotes, generateFlashcards, generateQuestions, generateMindMap]);

  // ── Scoring ──────────────────────────────────────────────
  const calculateScore = useCallback(() => {
    let correct = 0, wrong = 0;
    parsedQuestions.forEach((q) => {
      if (selectedAnswers[q.id] !== undefined) {
        if (selectedAnswers[q.id] === q.correct) correct++; else wrong++;
      }
    });
    const marks = examMode === "simulation" ? correct * 4 - wrong * (negativeMarking * 4) : correct * 4;
    return { correct, wrong, unanswered: parsedQuestions.length - correct - wrong, marks, total: parsedQuestions.length * 4 };
  }, [selectedAnswers, parsedQuestions, examMode, negativeMarking]);

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Tab configs ──────────────────────────────────────────
  const leftTabs: { id: LeftTab; label: string; icon: LucideIcon }[] = [
    { id: "study", label: "Study Material", icon: BookOpen },
    { id: "paper", label: "Question Paper", icon: FileQuestion },
    { id: "notes", label: "AI Notes", icon: StickyNote },
    { id: "flashcards", label: "Flashcards", icon: Layers },
    { id: "mindmap", label: "Mind Map", icon: Network },
  ];
  const rightTabs: { id: RightTab; label: string; icon: LucideIcon }[] = [
    { id: "chat", label: "AI Copilot", icon: MessageSquare },
    { id: "exam", label: "Exam Engine", icon: ClipboardList },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "revision", label: "Revision", icon: RefreshCw },
    { id: "planner", label: "Planner", icon: CalendarDays },
    { id: "graph", label: "Knowledge Graph", icon: GitBranch },
  ];

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#090909]">
      {/* ═══ VIDEO BACKGROUND LAYER ═══ */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        src="/Background_4.mp4"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 0,
          filter: 'brightness(0.60) contrast(0.90) saturate(0.60)',
          opacity: 0.75,
          pointerEvents: 'none',
          transform: 'scale(1.02)',
        }}
      />
      {/* ═══ DARK OVERLAY ═══ */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
          background: 'linear-gradient(180deg, rgba(9,9,9,0.30) 0%, rgba(9,9,9,0.45) 50%, rgba(9,9,9,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
      {/* ═══ UI CONTENT ═══ */}
      <div className="relative flex h-full flex-col text-white overflow-hidden" style={{ zIndex: 2 }}>
      {/* ═══ HEADER ═══ */}
      <header className="relative z-50 flex items-center justify-between glass px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', borderRadius: 0 }}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-dark via-gold to-gold-light shadow-lg shadow-gold/10">
              <Brain className="h-5 w-5 text-white" />
            </div>
            {/* <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#090909] pulse-ring" /> */}
          </div>
          <div>
            <h1 className="text-[15px] font-serif tracking-tight text-white" style={{ fontFamily: '"Inter", Georgia, serif' }}>Abhyas <span className="text-shimmer">AI</span> Copilot</h1>
            {/* <p className="text-[10px] text-white/35 tracking-wide uppercase">AI Exam Engine</p> */}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Ollama Status */}
          {/* <div className={`flex items-center gap-1.5 rounded-2xl glass-light px-2.5 py-1.5 text-[11px] card-hover ${ollamaStatus === "connected" ? "text-emerald-400" : ollamaStatus === "checking" ? "text-yellow-400" : "text-rose-400"}`}>
            <div className={`h-2 w-2 rounded-full ${ollamaStatus === "connected" ? "bg-emerald-400 pulse-ring" : ollamaStatus === "checking" ? "bg-yellow-400 animate-pulse" : "bg-rose-400"}`} />
            {ollamaStatus === "connected" ? ollamaModel.split(":")[0] : ollamaStatus === "checking" ? "Connecting..." : "Ollama Off"}
          </div> */}
          {/* Upload */}
          <button onClick={() => setShowUpload(true)} className="flex items-center gap-1.5 rounded-2xl glass-light px-2.5 py-1.5 text-[11px] text-white/65 transition hover:text-white">
            <Database className="h-3.5 w-3.5 text-gold" />
            <span>{uploadedDocs.filter(d => d.status === "indexed").length} docs</span>
            {uploadedDocs.some((d) => d.status === "indexing") && <RefreshCw className="h-3 w-3 animate-spin text-yellow-400" />}
          </button>
          {/* Agent */}
          <button onClick={runAgent} disabled={agentRunning} className="flex items-center gap-1.5 rounded-2xl btn-premium px-3 py-1.5 text-[11px] font-medium  disabled:opacity-50">
            <Cpu className={`h-3.5 w-3.5 ${agentRunning ? "animate-spin" : ""}`} />{agentRunning ? "Running..." : "Agent"}
          </button>
          {/* Exam selector */}
          <div className="relative">
            <button onClick={() => setShowExamSelector(!showExamSelector)} className="flex items-center gap-1.5 rounded-2xl glass-light px-2.5 py-1.5 text-[11px] text-white/65 hover:text-white transition card-hover">
              <GraduationCap className="h-3.5 w-3.5 text-gold" />
              {selectedExam}
              <ChevronDown className={`h-3 w-3 transition-transform ${showExamSelector ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {showExamSelector && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 w-52 rounded-3xl glass p-2 shadow-2xl z-50 max-h-64 overflow-y-auto gradient-border">
                  {SUPPORTED_EXAMS.map((exam) => (
                    <button key={exam} onClick={() => { setSelectedExam(exam); setShowExamSelector(false); }}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-[11px] transition ${selectedExam === exam ? "bg-gold/15 text-gold font-medium" : "text-white/65 hover:bg-white/8/50 hover:text-white"}`}>
                      {exam}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* ═══ AGENT BANNER ═══ */}
      <AnimatePresence>
        {agentSteps.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-b border-gold/20 bg-gold/5/30 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto">
              <Cpu className="h-4 w-4 text-gold shrink-0 spin-slow" />
              <span className="text-[11px] font-medium text-gold-light shrink-0">AI Agent:</span>
              <div className="flex items-center gap-2">
                {agentSteps.map((s, i) => (
                  <div key={i} className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] shrink-0 ${s.status === "done" ? "bg-emerald-500/10 text-emerald-400" : s.status === "running" ? "bg-gold/15 text-gold-light shimmer" : "bg-white/8/50 text-white/35"}`}>
                    {s.status === "done" ? <CheckCircle2 className="h-3 w-3" /> : s.status === "running" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CircleDot className="h-3 w-3" />}
                    <span className="truncate max-w-[120px]">{s.step}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setAgentSteps([])} className="ml-auto shrink-0 text-white/35 hover:text-white/65"><X className="h-3.5 w-3.5" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ SPLIT PANELS ═══ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── LEFT PANEL ─── */}
        <div className="flex w-[48%] flex-col" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex glass-subtle overflow-x-auto px-1 py-1 mx-2 mt-2 rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            {leftTabs.map((t) => (
              <button key={t.id} onClick={() => setLeftTab(t.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-medium transition-all whitespace-nowrap relative rounded-xl ${leftTab === t.id ? "text-gold bg-gold/8 tab-glow" : "text-white/40 hover:text-white/65 hover:bg-white/4"}`}>
                <t.icon className="h-3.5 w-3.5" />{t.label}
              </button>
            ))}
          </div>

          {/* Tutor Mode + Exam Selector Bar */}
          {leftTab !== "study" && (
            <div className="flex items-center justify-between px-4 py-2.5 mx-2 mt-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-white/25 mr-1 uppercase tracking-wider">Mode:</span>
                {([["beginner", "👶 Beginner"], ["exam", "🎯 Exam"], ["stepwise", "📝 Steps"], ["hindi", "🇮🇳 Hindi"], ["hinglish", "🗣️ Hinglish"]] as [TutorMode, string][]).map(([m, l]) => (
                  <button key={m} onClick={() => setTutorMode(m)} className={`rounded-xl px-2 py-0.5 text-[9px] font-medium transition-all ${tutorMode === m ? "bg-gold/12 text-gold" : "text-white/30 hover:text-white/55 hover:bg-white/4"}`}>{l}</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <GraduationCap className="h-3 w-3 text-gold/60" />
                <span className="text-[9px] text-gold/70 font-medium">{selectedExam}</span>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            <AnimatePresence mode="wait">
              {/* ── STUDY MATERIAL ── */}
              {leftTab === "study" && (
                <motion.div key="study" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {!hasDocuments ? (
                    <EmptyState icon={BookOpen} title="No Study Materials" description="Upload your textbooks, PDFs, notes, or ebooks to get started. The AI will index and analyze them for intelligent Q&A." action="Upload Documents" onAction={() => setShowUpload(true)} />
                  ) : (
                    <>
                      {/* Search Bar */}
                      <div className="mb-3 flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -tranneutral-y-1/2 h-3.5 w-3.5 text-white/35" />
                          <input
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(0); }}
                            placeholder="Search across all uploaded documents..."
                            className="w-full rounded-lg border border-white/8 bg-white/3 pl-9 pr-3 py-2 text-[12px] text-white/85 placeholder:text-white/35 outline-none focus:border-gold/40 transition"
                          />
                          {searchQuery && (
                            <button onClick={() => { setSearchQuery(""); setCurrentPage(0); }} className="absolute right-2 top-1/2 -tranneutral-y-1/2 text-white/35 hover:text-white">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <button onClick={() => setShowUpload(true)} className="rounded-2xl glass-light p-2 text-white/50 hover:text-gold transition"><Upload className="h-3.5 w-3.5" /></button>
                      </div>

                      {searchQuery && (
                        <div className="mb-2">
                          <Badge color={filteredPages.length > 0 ? "emerald" : "rose"}>
                            {filteredPages.length > 0 ? `${filteredPages.length} results found` : "No results"}
                          </Badge>
                        </div>
                      )}

                      {/* Document badges */}
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {uploadedDocs.filter(d => d.status === "indexed").map((d) => (
                          <Badge key={d.name} color="amber"><FileText className="h-3 w-3" />{d.name}{d.pages && <span className="text-white/35">({d.pages}p)</span>}</Badge>
                        ))}
                      </div>

                      {/* Page content */}
                      {currentPageData ? (
                        <>
                          <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-white">{currentPageData.title}</h2>
                            <Badge color="neutral">Page {currentPage + 1}/{displayPages.length}</Badge>
                          </div>
                          <div className={`rounded-3xl glass p-5 text-[12.5px] leading-relaxed text-white/75 ${highlightedSection === "full-page" ? "highlight-flash" : ""}`}>
                            {currentPageData.content.split("\n").map((line, i) => (
                              <p key={i} className={`${line.startsWith("•") || line.startsWith("-") ? "pl-3" : ""} ${line.startsWith("#") ? "text-sm font-bold text-white mt-3" : ""}`}>
                                {line || "\u00A0"}
                              </p>
                            ))}
                          </div>
                          {/* Pagination */}
                          <div className="mt-3 flex items-center justify-between">
                            <button onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} disabled={currentPage <= 0} className="flex items-center gap-1 rounded-2xl glass-light px-2.5 py-1.5 text-[11px] text-white/65 hover:text-white transition disabled:opacity-30">
                              <ChevronLeft className="h-3.5 w-3.5" />Prev
                            </button>
                            <div className="flex gap-1">
                              {displayPages.slice(Math.max(0, currentPage - 2), currentPage + 3).map((_, i) => {
                                const idx = Math.max(0, currentPage - 2) + i;
                                return (
                                  <button key={idx} onClick={() => setCurrentPage(idx)} className={`h-7 w-7 rounded-md text-[11px] font-medium transition ${idx === currentPage ? "bg-gold-dark text-white" : "glass-light text-white/50 hover:text-white/75"}`}>{idx + 1}</button>
                                );
                              })}
                            </div>
                            <button onClick={() => setCurrentPage((p) => Math.min(displayPages.length - 1, p + 1))} disabled={currentPage >= displayPages.length - 1} className="flex items-center gap-1 rounded-2xl glass-light px-2.5 py-1.5 text-[11px] text-white/65 hover:text-white transition disabled:opacity-30">
                              Next<ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-center text-[12px] text-white/35 py-8">No content to display. Upload more documents or adjust your search.</p>
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {/* ── QUESTION PAPER ── */}
              {leftTab === "paper" && (
                <motion.div key="paper" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {parsedQuestions.length === 0 ? (
                    <div className="text-center py-8">
                      <EmptyState icon={FileQuestion} title="No Questions Yet" description={hasDocuments ? "Generate practice questions from your uploaded documents using AI." : `Upload a ${selectedExam} document first.`} action={hasDocuments ? undefined : "Upload Document"} onAction={() => setShowUpload(true)} />
                      {hasDocuments && (
                        <button onClick={() => generateQuestions()} disabled={generatingQuestions} className="mt-4 rounded-2xl btn-premium px-5 py-2 text-[12px] font-medium  disabled:opacity-50">
                          {generatingQuestions ? <><RefreshCw className="inline h-3.5 w-3.5 mr-1.5 animate-spin" />Generating Questions...</> : <><Cpu className="inline h-3.5 w-3.5 mr-1.5" />Generate Practice Questions</>}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-bold text-white flex items-center gap-2"><FileQuestion className="h-4 w-4 text-gold" />Questions ({parsedQuestions.length})</h2>
                        <button onClick={() => generateQuestions()} disabled={generatingQuestions} className="rounded-md bg-gold-dark/20 px-2.5 py-1 text-[10px] font-medium text-gold-light hover:bg-gold-dark/30 transition disabled:opacity-50">
                          {generatingQuestions ? "Generating..." : "⟳ Regenerate"}
                        </button>
                      </div>
                      {parsedQuestions.map((q, i) => (
                        <button key={q.id} onClick={() => { setCurrentQuestion(i); setRightTab("exam"); }}
                          className={`w-full rounded-lg border p-2.5 text-left text-[12px] transition-all ${currentQuestion === i ? "border-gold/50 bg-gold/10 text-white" : "border-white/4 glass-light text-white/65 hover:border-white/10"}`}>
                          <div className="flex items-start gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10/80 text-[9px] font-bold">{q.id}</span>
                            <span className="line-clamp-2 flex-1">{q.text}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── AI NOTES ── */}
              {leftTab === "notes" && (
                <motion.div key="notes" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {!generatedNotes && !generatingNotes ? (
                    <div className="text-center py-8">
                      <EmptyState icon={StickyNote} title="No Notes Yet" description={hasDocuments ? "Generate comprehensive study notes from your uploaded documents." : "Upload study materials first."} action={hasDocuments ? undefined : "Upload Documents"} onAction={() => setShowUpload(true)} />
                      {hasDocuments && (
                        <button onClick={() => generateNotes()} disabled={generatingNotes} className="mt-4 rounded-2xl btn-premium px-5 py-2 text-[12px] font-medium  disabled:opacity-50">
                          <StickyNote className="inline h-3.5 w-3.5 mr-1.5" />Generate Study Notes
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-white flex items-center gap-2"><StickyNote className="h-4 w-4 text-gold" />AI Study Notes {generatingNotes && <span className="text-[10px] text-gold animate-pulse">● Generating...</span>}</h2>
                        <button onClick={() => generateNotes()} disabled={generatingNotes} className="rounded-md bg-gold-dark/20 px-2.5 py-1 text-[10px] font-medium text-gold-light hover:bg-gold-dark/30 transition disabled:opacity-50">
                          {generatingNotes ? "Generating..." : "⟳ Regenerate"}
                        </button>
                      </div>
                      <div className="rounded-3xl glass neon-glow p-5 text-[12.5px] leading-relaxed text-white/75 stat-shine">
                        <FormattedText text={generatedNotes} />
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── FLASHCARDS ── */}
              {leftTab === "flashcards" && (
                <motion.div key="flashcards" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {flashcards.length === 0 && !generatingFlashcards ? (
                    <div className="text-center py-8">
                      <EmptyState icon={Layers} title="No Flashcards Yet" description={hasDocuments ? "Generate flashcards from your uploaded documents for quick revision." : "Upload study materials first."} action={hasDocuments ? undefined : "Upload Documents"} onAction={() => setShowUpload(true)} />
                      {hasDocuments && (
                        <button onClick={() => generateFlashcards()} disabled={generatingFlashcards} className="mt-4 rounded-2xl btn-premium px-5 py-2 text-[12px] font-medium  disabled:opacity-50">
                          <Layers className="inline h-3.5 w-3.5 mr-1.5" />Generate Flashcards
                        </button>
                      )}
                    </div>
                  ) : generatingFlashcards ? (
                    <div className="text-center py-12">
                      <RefreshCw className="mx-auto h-8 w-8 text-yellow-400 animate-spin mb-3" />
                      <p className="text-sm text-white/65">Generating flashcards...</p>
                      <p className="text-[10px] text-white/35 mt-1">This may take 20-30 seconds</p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-bold text-white flex items-center gap-2"><Layers className="h-4 w-4 text-gold" />Flashcards ({filteredFlashcards.length})</h2>
                        <div className="flex items-center gap-2">
                          <button onClick={() => generateFlashcards()} disabled={generatingFlashcards} className="rounded-md bg-gold-dark/20 px-2.5 py-1 text-[10px] font-medium text-gold-light hover:bg-gold-dark/30 transition disabled:opacity-50">⟳ Regenerate</button>
                          <div className="flex gap-1">
                            {(["all", "Easy", "Medium", "Hard"] as const).map((f) => (
                              <button key={f} onClick={() => setFlashFilter(f)} className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${flashFilter === f ? "bg-gold-dark text-white" : "glass-light text-white/50"}`}>{f === "all" ? "All" : f}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {filteredFlashcards.map((card) => {
                          const isFlipped = flippedCards.has(card.id);
                          return (
                            <div key={card.id} className="flip-card h-40 cursor-pointer card-hover" onClick={() => setFlippedCards((p) => { const n = new Set(p); if (n.has(card.id)) n.delete(card.id); else n.add(card.id); return n; })}>
                              <div className={`flip-card-inner w-full h-full ${isFlipped ? "flipped" : ""}`}>
                                <div className="flip-card-front rounded-3xl glass p-4 flex flex-col justify-between">
                                  <Badge color={card.difficulty === "Easy" ? "emerald" : card.difficulty === "Medium" ? "amber" : "rose"}>{card.difficulty}</Badge>
                                  <p className="text-sm font-medium text-white">{card.q}</p>
                                  <p className="text-[9px] text-white/35 text-center">Click to flip</p>
                                </div>
                                <div className="flip-card-back rounded-2xl bg-gradient-to-br from-gold/5/90 to-black/90 border border-gold/20 p-4 flex flex-col justify-between">
                                  <Badge color="amber">Answer</Badge>
                                  <p className="text-[12px] text-gold-light leading-relaxed">{card.a}</p>
                                  <p className="text-[9px] text-gold/50 text-center">Click to flip back</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </motion.div>
              )}

              {/* ── MIND MAP ── */}
              {leftTab === "mindmap" && (
                <motion.div key="mindmap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {!hasDocuments ? (
                    <EmptyState icon={Network} title="No Mind Map" description="Upload study materials to generate a visual mind map." action="Upload Documents" onAction={() => setShowUpload(true)} />
                  ) : !mindMapData && !generatingMindMap ? (
                    <div className="text-center py-8">
                      <Network className="mx-auto h-10 w-10 text-gold mb-3" />
                      <h3 className="text-sm font-bold text-white mb-1">Generate Mind Map</h3>
                      <p className="text-[11px] text-white/50 mb-4">AI will analyze your documents and create a visual concept map.</p>
                      <button onClick={() => generateMindMap()} className="rounded-2xl btn-premium px-5 py-2 text-[12px] font-medium ">
                        <Cpu className="inline h-3.5 w-3.5 mr-1.5" />Generate Mind Map
                      </button>
                    </div>
                  ) : generatingMindMap ? (
                    <div className="text-center py-12">
                      <RefreshCw className="mx-auto h-8 w-8 text-yellow-400 animate-spin mb-3" />
                      <p className="text-sm text-white/65">Building mind map...</p>
                      <p className="text-[10px] text-white/35 mt-1">Analyzing document structure</p>
                    </div>
                  ) : mindMapData ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-white flex items-center gap-2"><Network className="h-4 w-4 text-gold" />Mind Map</h2>
                        <button onClick={() => generateMindMap()} className="rounded-md bg-gold-dark/20 px-2.5 py-1 text-[10px] font-medium text-gold-light hover:bg-gold-dark/30 transition">⟳ Regenerate</button>
                      </div>
                      <div className="rounded-3xl glass p-6 overflow-auto">
                        {/* Central Node */}
                        <div className="flex flex-col items-center">
                          <div className="rounded-2xl bg-gradient-to-r from-gold-dark to-gold px-5 py-3 text-sm font-bold text-black shadow-lg shadow-gold/15 mb-6 neon-glow">
                            {mindMapData.central}
                          </div>
                          {/* Branches */}
                          <div className="flex flex-wrap justify-center gap-4 w-full">
                            {mindMapData.branches.map((branch, bi) => {
                              const colors = ["emerald", "sky", "amber", "rose", "amber", "cyan"];
                              const c = colors[bi % colors.length];
                              const isExpanded = expandedNodes.has(`b-${bi}`);
                              return (
                                <div key={bi} className="flex flex-col items-center min-w-[140px] max-w-[200px]">
                                  {/* Connector line */}
                                  <div className={`w-0.5 h-4 bg-${c}-500/30`} />
                                  {/* Branch node */}
                                  <button
                                    onClick={() => setExpandedNodes((prev) => { const n = new Set(prev); if (n.has(`b-${bi}`)) n.delete(`b-${bi}`); else n.add(`b-${bi}`); return n; })}
                                    className={`rounded-lg border border-${c}-500/30 bg-${c}-500/10 px-3 py-2 text-[11px] font-semibold text-${c}-300 hover:bg-${c}-500/20 transition w-full text-center`}
                                  >
                                    {branch.label} {branch.children && branch.children.length > 0 && <span className="text-[9px] opacity-60">{isExpanded ? "▼" : "▶"}</span>}
                                  </button>
                                  {/* Children */}
                                  {isExpanded && branch.children && (
                                    <div className="mt-1 space-y-1 w-full">
                                      {branch.children.map((child, ci) => (
                                        <div key={ci} className="flex items-center gap-1.5 ml-4">
                                          <div className={`w-2 h-0.5 bg-${c}-500/20`} />
                                          <div className={`rounded-md border border-white/10/50 bg-white/8/50 px-2.5 py-1.5 text-[10px] text-white/65 flex-1`}>
                                            {child.label}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ─── RIGHT PANEL ─── */}
        <div className="flex w-[52%] flex-col">
          <div className="flex glass-subtle overflow-x-auto px-1 py-1 mx-2 mt-2 rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            {rightTabs.map((t) => (
              <button key={t.id} onClick={() => setRightTab(t.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-medium transition-all whitespace-nowrap relative rounded-xl ${rightTab === t.id ? "text-gold bg-gold/8 tab-glow" : "text-white/40 hover:text-white/65 hover:bg-white/4"}`}>
                <t.icon className="h-3.5 w-3.5" />{t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-1 flex-col overflow-hidden">
            <AnimatePresence mode="wait">
              {/* ═══ AI COPILOT CHAT ═══ */}
              {rightTab === "chat" && (
                <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg) => (
                      <div key={msg.id} className={`slide-up ${msg.role === "user" ? "flex justify-end" : ""}`}>
                        {msg.role === "system" ? (
                          <div className="flex items-start gap-3 rounded-3xl glass border-glow p-4">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold/20 to-gold/20"><Sparkles className="h-4 w-4 text-gold" /></div>
                            <div>
                              <p className="text-[12px] leading-relaxed text-white/65">{msg.content}</p>
                              {uploadedDocs.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {uploadedDocs.filter(d => d.status === "indexed").map((d) => <Badge key={d.name} color="amber"><FileText className="h-3 w-3" />{d.name}</Badge>)}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : msg.role === "user" ? (
                          <div className="max-w-[70%]">
                            <div className="rounded-2xl rounded-br-sm bg-gradient-to-r from-gold-dark to-gold px-4 py-2.5 text-[12.5px] text-white shadow-lg shadow-gold/10">{msg.content}</div>
                            {msg.tutorMode && <p className="mt-1 text-right text-[9px] text-white/35">Mode: {msg.tutorMode}</p>}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="flex items-start gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold shadow shadow-gold/10"><Brain className="h-4 w-4 text-white" /></div>
                              <div className="rounded-2xl rounded-tl-sm glass px-4 py-2.5 text-[12.5px] text-white/75"><FormattedText text={msg.content} /></div>
                            </div>
                            {msg.layers && (
                              <div className="ml-11 space-y-2.5">
                                {msg.layers.grounded && (
                                  <div className="rounded-2xl border border-emerald-500/15 bg-emerald-950/15 p-3.5">
                                    <div className="mb-2 flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-400"><BookMarked className="h-3.5 w-3.5" />LAYER 1 — Grounded Answer<Badge color="emerald">{(msg.layers.grounded.confidence * 100).toFixed(0)}%</Badge></div>
                                      <Badge color="neutral"><FileText className="h-3 w-3" />{msg.layers.grounded.docName}</Badge>
                                    </div>
                                    <FormattedText text={msg.layers.grounded.text} />
                                    <button onClick={() => handleDeepLink(msg.layers!.grounded!.page)} className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition">
                                      <Link2 className="h-3 w-3" />Jump to Page {msg.layers.grounded.page}<ArrowRight className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                                {msg.layers.web && (
                                  <div className="rounded-2xl border border-sky-500/15 bg-sky-950/15 p-3.5">
                                    <div className="mb-2 flex items-center gap-2 text-[10px] font-bold text-sky-400"><Globe className="h-3.5 w-3.5" />LAYER 2 — Web Intelligence</div>
                                    <p className="mb-2 text-[12px] leading-relaxed text-white/75">{msg.layers.web.text}</p>
                                    <div className="space-y-1">{msg.layers.web.sources.map((s, i) => (
                                      <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-md bg-sky-500/5 px-2 py-1 text-[10px] text-sky-300 hover:bg-sky-500/15 transition cursor-pointer"><ExternalLink className="h-3 w-3 text-sky-500 shrink-0" /><span className="truncate">{s.title}</span></a>
                                    ))}</div>
                                  </div>
                                )}
                                {msg.layers.multimedia && (
                                  <div className="rounded-2xl border border-gold/15 bg-gold/5/15 p-3.5">
                                    <div className="mb-2 flex items-center gap-2 text-[10px] font-bold text-gold"><ImageIcon className="h-3.5 w-3.5" />LAYER 3 — Visual Learning</div>
                                    {msg.layers.multimedia.videoTitle && (
                                      <a href={msg.layers.multimedia.videoUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(msg.layers.multimedia.videoTitle)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-black/60 border border-gold/10 p-2.5 flex items-center gap-3 hover:bg-black/80 transition cursor-pointer group">
                                        <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-red-600 to-red-700 group-hover:from-red-500 group-hover:to-red-600 transition"><Play className="h-4 w-4 text-white ml-0.5" /></div>
                                        <div className="flex-1"><p className="text-[11px] font-medium text-white/85">{msg.layers.multimedia.videoTitle}</p><p className="text-[9px] text-white/50">Click to search on YouTube</p></div>
                                        <div className="flex items-center gap-1 rounded-md bg-gold/10 px-2 py-1 text-[10px] text-gold-light group-hover:bg-gold/20 transition"><Video className="h-3 w-3" />Watch</div>
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {isTyping && (
                      <div className="flex items-start gap-3 slide-up">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold"><Brain className="h-4 w-4 text-white" /></div>
                        <div className="rounded-2xl rounded-tl-sm glass px-4 py-3">
                          <div className="flex items-center gap-2"><div className="flex gap-1"><div className="h-2 w-2 rounded-full bg-gold typing-dot" /><div className="h-2 w-2 rounded-full bg-gold typing-dot" /><div className="h-2 w-2 rounded-full bg-gold typing-dot" /></div><span className="text-[10px] text-white/50">{ollamaStatus === "connected" ? `Generating with ${ollamaModel}... (may take 30-60 seconds)` : "Searching documents..."}</span></div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  {/* Input */}
                  <div className="p-4 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-white/30 mr-1 uppercase tracking-wider">Tutor:</span>
                      {([["beginner", "Beginner"], ["exam", "Exam"], ["stepwise", "Step-by-Step"], ["hindi", "Hindi"], ["hinglish", "Hinglish"]] as [TutorMode, string][]).map(([m, l]) => (
                        <button key={m} onClick={() => setTutorMode(m)} className={`rounded-xl px-2.5 py-1 text-[9px] font-medium transition-all ${tutorMode === m ? "bg-gold/15 text-gold border border-gold/20" : "text-white/35 hover:text-white/60 hover:bg-white/4"}`}>{l}</button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                        placeholder={hasDocuments ? "Ask anything about your study materials..." : "Upload documents and start asking questions..."}
                        className="flex-1 glass-subtle rounded-2xl px-5 py-3 text-[13px] text-white/85 placeholder:text-white/25 outline-none focus:border-gold/30 focus:shadow-[0_0_20px_rgba(212,175,55,0.08)] transition" style={{ border: '1px solid rgba(255,255,255,0.06)' }} />
                      <button onClick={sendMessage} disabled={!chatInput.trim() || isTyping} className="flex h-11 w-11 items-center justify-center rounded-2xl btn-premium disabled:opacity-30"><Send className="h-4 w-4" /></button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ═══ EXAM ENGINE ═══ */}
              {rightTab === "exam" && (
                <motion.div key="exam" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col overflow-hidden">
                  {parsedQuestions.length === 0 ? (
                    <div className="flex-1 p-4 flex flex-col items-center justify-center">
                      <EmptyState icon={ClipboardList} title="No Questions Loaded" description={hasDocuments ? `Generate ${selectedExam}-style practice questions from your uploaded documents.` : `Upload a ${selectedExam} document to get started.`} action={hasDocuments ? undefined : "Upload Document"} onAction={() => setShowUpload(true)} />
                      {hasDocuments && (
                        <div className="mt-4 flex flex-col items-center gap-3">
                          <button onClick={() => generateQuestions()} disabled={generatingQuestions} className="rounded-2xl btn-premium px-6 py-2.5 text-[12px] font-medium  disabled:opacity-50">
                            {generatingQuestions ? <><RefreshCw className="inline h-3.5 w-3.5 mr-1.5 animate-spin" />Generating {selectedExam} Questions...</> : <><Cpu className="inline h-3.5 w-3.5 mr-1.5" />Generate {selectedExam} Questions</>}
                          </button>
                          <p className="text-[10px] text-white/35">Mode: {tutorMode} • Exam: {selectedExam}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Controls */}
                      <div className="border-b border-white/6 bg-[#0F1115]/60 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex rounded-lg bg-white/8/80 p-0.5">
                              <button onClick={() => { setExamMode("practice"); setExamStarted(false); setExamSubmitted(false); setSelectedAnswers({}); setRevealedAnswers(new Set()); }}
                                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition ${examMode === "practice" ? "bg-emerald-500/15 text-emerald-400" : "text-white/50"}`}><Eye className="h-3.5 w-3.5" />Practice</button>
                              <button onClick={() => { setExamMode("simulation"); setExamStarted(false); setExamSubmitted(false); setSelectedAnswers({}); setRevealedAnswers(new Set()); setExamTimer(3600); }}
                                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition ${examMode === "simulation" ? "bg-rose-500/15 text-rose-400" : "text-white/50"}`}><Shield className="h-3.5 w-3.5" />Simulation</button>
                            </div>
                            {examMode === "simulation" && !examStarted && <button onClick={() => setExamStarted(true)} className="flex items-center gap-1 rounded-2xl bg-gradient-to-r from-gold-dark to-gold px-3 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-gold/10"><Play className="h-3.5 w-3.5" />Start</button>}
                            <button onClick={() => { setExamStarted(false); setExamSubmitted(false); setSelectedAnswers({}); setRevealedAnswers(new Set()); setExamTimer(3600); setCurrentQuestion(0); }} className="flex items-center gap-1 rounded-2xl glass-light px-2 py-1.5 text-[10px] text-white/65 hover:text-white/75"><RotateCcw className="h-3 w-3" />Reset</button>
                          </div>
                          <div className="flex items-center gap-2">
                            {examMode === "simulation" && examStarted && !examSubmitted && (
                              <div className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${examTimer < 300 ? "bg-rose-500/20 text-rose-400 timer-pulse" : "glass-light text-white/75"}`}><Timer className="h-4 w-4" />{formatTime(examTimer)}</div>
                            )}
                            {examMode === "simulation" && <Badge color="rose"><AlertTriangle className="h-3 w-3" />-{negativeMarking * 4}/wrong</Badge>}
                            <Badge color="neutral">Q{currentQuestion + 1}/{parsedQuestions.length}</Badge>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {parsedQuestions.map((q, i) => {
                            const isAns = selectedAnswers[q.id] !== undefined;
                            const isCur = currentQuestion === i;
                            const isC = selectedAnswers[q.id] === q.correct;
                            const show = examMode === "practice" || examSubmitted;
                            return <button key={q.id} onClick={() => setCurrentQuestion(i)} className={`flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold transition ${isCur ? "bg-gold-dark text-white ring-2 ring-gold/30" : isAns && show ? (isC ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400") : isAns ? "bg-gold/15 text-gold" : "bg-white/4 text-white/50"}`}>{q.id}</button>;
                          })}
                        </div>
                      </div>
                      {/* Question display */}
                      <div className="flex-1 overflow-y-auto p-4">
                        {(examMode === "practice" || examStarted) && questionObj && !examSubmitted ? (
                          <div className="slide-up space-y-3">
                            <div className="flex items-start gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/15 font-bold text-sm text-gold">{questionObj.id}</div>
                              <div><p className="text-[13px] font-medium text-white leading-relaxed">{questionObj.text}</p>
                                <div className="mt-1 flex gap-2"><Badge color="neutral">{questionObj.topic}</Badge><Badge color="amber">+4 marks</Badge></div></div>
                            </div>
                            <div className="space-y-2">
                              {questionObj.options.map((opt, oi) => {
                                const isSel = selectedAnswers[questionObj.id] === oi;
                                const isCorr = questionObj.correct === oi;
                                const showFB = examMode === "practice" && selectedAnswers[questionObj.id] !== undefined;
                                return (
                                  <button key={oi} onClick={() => { if (showFB) return; setSelectedAnswers((p) => ({ ...p, [questionObj.id]: oi })); if (examMode === "practice") setRevealedAnswers((p) => new Set([...p, questionObj.id])); }}
                                    className={`w-full rounded-2xl border p-3 text-left text-[12.5px] transition-all ${showFB ? (isCorr ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" : isSel ? "border-rose-500/30 bg-rose-500/8 text-rose-300" : "border-white/4 text-white/50") : isSel ? "border-gold/30 bg-gold/8 text-gold-light" : "border-white/4 glass-light text-white/75 hover:border-white/35"}`}>
                                    <div className="flex items-center gap-3">
                                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${showFB ? (isCorr ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : isSel ? "border-rose-500 bg-rose-500/20 text-rose-400" : "border-white/10 text-white/35") : isSel ? "border-gold bg-gold/20 text-gold" : "border-white/10 text-white/35"}`}>{String.fromCharCode(65 + oi)}</div>
                                      <span>{opt}</span>
                                      {showFB && isCorr && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" />}
                                      {showFB && isSel && !isCorr && <XCircle className="ml-auto h-4 w-4 text-rose-400" />}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            {examMode === "practice" && revealedAnswers.has(questionObj.id) && (
                              <div className="slide-up rounded-2xl border border-gold/15 bg-gold/5/15 p-3">
                                <button onClick={() => setExpandedExp(expandedExp === questionObj.id ? null : questionObj.id)} className="flex w-full items-center justify-between text-[10px] font-bold text-gold">
                                  <span className="flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5" />Explanation</span>
                                  {expandedExp === questionObj.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                                {expandedExp === questionObj.id && <p className="mt-2 text-[12px] leading-relaxed text-white/75">{questionObj.explanation}</p>}
                              </div>
                            )}
                            <div className="flex items-center justify-between pt-2">
                              <button onClick={() => setCurrentQuestion((p) => Math.max(0, p - 1))} disabled={currentQuestion === 0} className="flex items-center gap-1 rounded-2xl glass-light px-3 py-1.5 text-[11px] text-white/65 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" />Prev</button>
                              {currentQuestion < parsedQuestions.length - 1 ? (
                                <button onClick={() => setCurrentQuestion((p) => p + 1)} className="flex items-center gap-1 rounded-lg bg-gold-dark px-3 py-1.5 text-[11px] font-medium text-white">Next<ChevronRight className="h-3.5 w-3.5" /></button>
                              ) : examMode === "simulation" ? (
                                <button onClick={() => setExamSubmitted(true)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-1.5 text-[11px] font-medium text-white"><CheckCircle2 className="h-3.5 w-3.5" />Submit</button>
                              ) : null}
                            </div>
                          </div>
                        ) : examSubmitted ? (
                          <div className="slide-up space-y-4">
                            <div className="rounded-3xl glass border-glow p-5 text-center">
                              <Award className="mx-auto h-10 w-10 text-gold mb-2" />
                              <h3 className="text-lg font-bold text-white">Exam Complete!</h3>
                            </div>
                            {(() => { const s = calculateScore(); return (
                              <div className="grid grid-cols-4 gap-2">
                                <StatCard icon={TrendingUp} label="Score" value={`${s.marks}/${s.total}`} color="amber" />
                                <StatCard icon={Target} label="Accuracy" value={`${parsedQuestions.length > 0 ? Math.round((s.correct / parsedQuestions.length) * 100) : 0}%`} color="emerald" />
                                <StatCard icon={CheckCircle2} label="Correct" value={`${s.correct}`} color="emerald" />
                                <StatCard icon={XCircle} label="Wrong" value={`${s.wrong}`} color="rose" />
                              </div>
                            ); })()}
                          </div>
                        ) : examMode === "simulation" && !examStarted ? (
                          <div className="flex flex-1 items-center justify-center h-full">
                            <div className="text-center space-y-3 max-w-xs">
                              <Shield className="mx-auto h-12 w-12 text-gold/60" />
                              <h3 className="text-sm font-bold text-white">Simulation Mode</h3>
                              <p className="text-[11px] text-white/50">Full exam simulation with timer and negative marking. Click Start when ready.</p>
                              <div className="flex items-center gap-2 justify-center text-[10px] text-white/35">
                                <span>Negative marking:</span>
                                <input type="range" min="0" max="1" step="0.25" value={negativeMarking} onChange={(e) => setNegativeMarking(parseFloat(e.target.value))} className="w-20" />
                                <span className="text-rose-400">{negativeMarking * 4}</span>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </motion.div>
              )}

              {/* ═══ ANALYTICS ═══ */}
              {rightTab === "analytics" && (
                <motion.div key="analytics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto p-4">
                  {examHistory.length === 0 ? (
                    <EmptyState icon={BarChart3} title="No Analytics Data" description="Complete practice tests or exam simulations to see your performance analytics, weakness detection, and syllabus heatmap here." />
                  ) : (
                    <p className="text-white/50 text-sm">Analytics will populate after exam attempts.</p>
                  )}
                </motion.div>
              )}

              {/* ═══ REVISION ═══ */}
              {rightTab === "revision" && (
                <motion.div key="revision" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto p-4">
                  <EmptyState icon={RefreshCw} title="Smart Revision Center" description="Upload study materials and complete practice sessions. The AI will create personalized revision plans based on spaced repetition and your weak areas." action={hasDocuments ? "Run AI Agent" : "Upload Documents"} onAction={() => hasDocuments ? runAgent() : setShowUpload(true)} />
                </motion.div>
              )}

              {/* ═══ PLANNER ═══ */}
              {rightTab === "planner" && (
                <motion.div key="planner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto p-4">
                  <EmptyState icon={CalendarDays} title="Study Planner" description={`Upload your ${selectedExam} syllabus and study materials. The AI will generate a personalized daily/weekly study plan optimized for your exam date and weak areas.`} action={hasDocuments ? "Generate Plan" : "Upload Documents"} onAction={() => hasDocuments ? runAgent() : setShowUpload(true)} />
                </motion.div>
              )}

              {/* ═══ KNOWLEDGE GRAPH ═══ */}
              {rightTab === "graph" && (
                <motion.div key="graph" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto p-4">
                  <EmptyState icon={GitBranch} title="Knowledge Graph" description="Upload study materials and the AI will build a visual knowledge graph showing concepts, relationships, and dependencies across your documents." action={hasDocuments ? "Build Graph" : "Upload Documents"} onAction={() => hasDocuments ? runAgent() : setShowUpload(true)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ═══ UPLOAD MODAL ═══ */}
      <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.epub,.txt,.pptx" className="hidden" onChange={(e) => { handleFileUpload(e.target.files); e.target.value = ""; }} />
      <AnimatePresence>
        {showUpload && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-lg rounded-2xl glass p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Database className="h-4 w-4 text-gold" />Document Library</h3>
                <div className="flex items-center gap-2">
                  <Badge color="amber">{uploadedDocs.length} documents</Badge>
                  <button onClick={() => setShowUpload(false)} className="rounded-lg p-1 text-white/50 hover:text-white hover:bg-white/5 transition"><X className="h-5 w-5" /></button>
                </div>
              </div>
              {/* Doc list */}
              <div className="space-y-2 mb-4 max-h-52 overflow-y-auto">
                {uploadedDocs.length === 0 && <p className="text-center text-[12px] text-white/35 py-4">No documents yet. Upload your study materials below.</p>}
                {uploadedDocs.map((doc) => (
                  <motion.div key={doc.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-2xl glass-light p-3 group">
                    <FileText className={`h-4 w-4 shrink-0 ${doc.status === "indexed" ? "text-gold" : doc.status === "indexing" ? "text-gold" : "text-white/35"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-white/75 truncate">{doc.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] text-white/35">{doc.size}</span>
                        {doc.status === "indexing" && <div className="flex-1 max-w-[120px] h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-gold to-gold shimmer" style={{ width: "60%" }} /></div>}
                      </div>
                    </div>
                    {doc.status === "indexed" && <Badge color="emerald"><CheckCircle2 className="h-3 w-3" />Indexed</Badge>}
                    {doc.status === "indexing" && <Badge color="amber"><RefreshCw className="h-3 w-3 animate-spin" />Extracting text...</Badge>}
                    {doc.status === "queued" && <Badge color="neutral"><Clock className="h-3 w-3" />Queued</Badge>}
                    {doc.status === "error" && <Badge color="rose"><XCircle className="h-3 w-3" />Error</Badge>}
                    <button onClick={(e) => { e.stopPropagation(); removeDoc(doc.name); }} className="rounded-md p-1 text-white/10 opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
                  </motion.div>
                ))}
              </div>
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${isDragging ? "border-gold bg-gold/10 scale-[1.02]" : "border-white/10/50 bg-black/30 hover:border-gold/40 hover:bg-gold/5"}`}>
                <Upload className={`mx-auto h-8 w-8 mb-2 transition ${isDragging ? "text-gold scale-110" : "text-white/35"}`} />
                <p className={`text-[12px] transition ${isDragging ? "text-gold-light" : "text-white/65"}`}>{isDragging ? "Drop files here" : "Drag & drop files here, or click to browse"}</p>
                <p className="text-[10px] text-white/35 mt-1">PDF • DOCX • EPUB • TXT • PPTX</p>
                <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="mt-3 rounded-2xl bg-gradient-to-r from-gold-dark to-gold px-4 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-gold/10 hover:shadow-gold/15 transition">Browse Files</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ EXAM SELECTOR BACKDROP ═══ */}
      {showExamSelector && <div className="fixed inset-0 z-40" onClick={() => setShowExamSelector(false)} />}
    </div>
    </div>
  );
}
