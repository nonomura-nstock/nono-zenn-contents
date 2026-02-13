import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// --- 引数チェック ---
const articlePath = process.argv[2];
if (!articlePath) {
  console.error(
    "使い方: GEMINI_API_KEY=<key> npm run review:gemini -- articles/<記事名>.md"
  );
  process.exit(1);
}

// --- API キーチェック ---
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(
    "環境変数 GEMINI_API_KEY が設定されていません。\n" +
      "Google AI Studio (https://aistudio.google.com/) で取得してください。\n\n" +
      "実行例:\n" +
      "  GEMINI_API_KEY=xxx npm run review:gemini -- articles/記事名.md"
  );
  process.exit(1);
}

// --- ファイル読み込み ---
function readFile(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf-8");
}

const article = readFile(articlePath);
const guideline = readFile("writing-guideline/guideline.md");
const reviewSpec = readFile("review-article-core.md");

// --- プロンプト構築 ---
const systemInstruction = `あなたはテックブログ記事のレビュアーです。以下のガイドラインとレビュー共通仕様に基づき、レビューを実施してください。

## ガイドライン

${guideline}

## レビュー共通仕様

${reviewSpec}`;

const userPrompt = `以下の記事をレビューしてください。

${article}`;

// --- Gemini API 呼び出し ---
const ai = new GoogleGenAI({ apiKey });

console.log("Gemini 3 Pro でレビュー中...\n");

const response = await ai.models.generateContent({
  model: "gemini-3-pro-preview",
  contents: userPrompt,
  config: {
    systemInstruction,
    temperature: 0.3,
    thinkingConfig: { thinkingLevel: "high" },
  },
});

console.log(response.text);
