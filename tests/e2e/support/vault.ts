// E2E 用の Vault。テストごとに一時フォルダへ書き出す。

const paragraph = (n: number, extra = '') =>
  `Paragraph ${n} explains how the scheduler picks the next task from the queue and why ordering matters for latency. ${extra}`.trim()

/** 1000 文字を大きく超える、見出しの多い文書。「needle」は大文字小文字違いを含めて 4 回出てくる。 */
export function longDoc(): string {
  const parts: string[] = ['# Long Document', '', 'Intro paragraph about scheduling.', '']
  for (let s = 1; s <= 12; s++) {
    parts.push(`## Section ${s}`, '')
    for (let p = 1; p <= 3; p++) {
      let extra = ''
      if (s === 2 && p === 1) extra = 'Here is the first needle in the text.'
      if (s === 5 && p === 2) extra = 'A second needle appears here, and a third needle follows.'
      if (s === 9 && p === 3) extra = 'Needle with a capital letter.'
      parts.push(paragraph((s - 1) * 3 + p, extra), '')
    }
  }
  return parts.join('\n')
}

export const TALK = `---
title: Intro to Event Loops
url: https://www.youtube.com/watch?v=abc123XYZ00
---

00:00:05

Welcome to this talk about the event loop.

[00:12] The event loop is what allows Node.js to perform non-blocking operations.

00:12:34 It offloads operations to the system kernel whenever possible.
`

export const SHORT = `---
title: Short Note
tags: [sample]
---

# Short Note

The quick brown fox jumps over the lazy dog.

A closure is a function that remembers the variables from the place where it was defined.

## Details

Second section paragraph about closures and scope.
`

export const FEATURES = `# Features

Visit https://example.com/auto for details, or read the [docs](https://example.com/docs).

This is ~~wrong~~ right.

| Key | Action |
| --- | --- |
| Cmd+L | Left drawer |
| Cmd+R | Right drawer |

- [ ] todo item
- [x] done item

\`\`\`ts
const answer: number = 42
\`\`\`

\`\`\`mermaid
graph TD
  A[Start] --> B[Finish]
\`\`\`

\`\`\`mermaid
this is definitely not a diagram ((
\`\`\`

Link to [[Other Note]] and ![[embedded.png]].

> [!note] Callout title
> Callout body.

<script>window.__xss = 'script'</script>

<img src="x" onerror="window.__xss = 'img'">

[bad link](javascript:window.__xss='link')
`

export function defaultVault(): Record<string, string> {
  return {
    '.obsidian/app.json': '{}',
    '.trash/deleted.md': '# deleted\n',
    '.hidden.md': '# hidden\n',
    'Books/Chapter 1.md': '# Chapter 1\n\nFirst chapter text.\n',
    'Books/Chapter 2.md': '# Chapter 2\n\nSecond chapter text.\n',
    'Books/Chapter 10.md': '# Chapter 10\n\nTenth chapter text.\n',
    'Books/cover.png': 'not a real image',
    'Empty/notes.txt': 'no markdown here',
    'Nested/Deep/only.txt': 'still no markdown',
    'videos/Talk.md': TALK,
    'apple.md': '# apple\n\nLowercase file name.\n',
    'Banana.md': '# Banana\n\nCapitalized file name.\n',
    'Features.md': FEATURES,
    'Long.md': longDoc(),
    'Short.md': SHORT
  }
}
