---
name: review-article
description: Review Zenn tech blog articles against writing guidelines and textlint rules. Use when the user asks to review an article, provides a markdown file path, or uses the /review-article command.
---

# Review Article

## Description
Reviews Zenn tech blog articles based on `writing-guideline/guideline.md` and `review-article-core.md`.

## Workflow

1.  **Identify the target file**: If not provided, ask the user.
2.  **Run automated lint checks**:
    ```bash
    npx textlint <path/to/article.md>
    ```
3.  **Perform manual guideline check**:
    Read `writing-guideline/guideline.md` and check for:
    -   **Accuracy**: Technical correctness, version numbers, official doc consistency.
    -   **Readability**: Sentence length (60-80 chars), paragraph structure, h2/h3 hierarchy.
    -   **Reproducibility**: Steps work, prerequisites clear.
    -   **Zenn Quality**: Front matter, code block filenames, message blocks, diff syntax.
    -   **Tone**: "Desu/Masu" style, polite.

## Output Format

Follow the structure defined in `review-article-core.md`:

### 良い点 (Good Points)
*   List at least 3 positive aspects.

### textlint チェック結果 (Lint Results)
*   List actionable errors found by `textlint`.
*   Exclude false positives (briefly explain why).

### ガイドライン準拠チェック (Guideline Check)
Group by category:
*   **正確性 (Accuracy)**
*   **読みやすさ (Readability)**
*   **再現性 (Reproducibility)**
*   **Zenn 品質 (Zenn Quality)**

Use prefixes for each point:
*   `[must]`: Mandatory fix (errors, bugs).
*   `[nits]`: Minor suggestion (style, preference).
*   `[q]`: Question/Clarification.

### まとめ (Summary)
*   Overall impression.
*   Top 3 priority fixes.
*   Strengths and improvement proposals.

## Feedback Tone
*   Start with positive feedback.
*   Be polite and constructive.
*   Provide reasons and specific examples for every `[must]` item.
