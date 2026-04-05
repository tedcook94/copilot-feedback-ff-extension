// ==========================================================================
// Copilot PR Comment Copier - Content Script
// ==========================================================================

(function () {
  "use strict";

  // Prevent double-initialization (SPA re-injection guard)
  if (window.__copilotCopyerInitialized) return;
  window.__copilotCopyerInitialized = true;

  // ---------- Constants & SVG Icons ----------

  const SVG_NS = "http://www.w3.org/2000/svg";

  /**
   * Creates a copy-icon SVG element (GitHub's clipboard icon).
   */
  function createCopyIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const p1 = document.createElementNS(SVG_NS, "path");
    p1.setAttribute(
      "d",
      "M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"
    );
    const p2 = document.createElementNS(SVG_NS, "path");
    p2.setAttribute(
      "d",
      "M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
    );
    svg.appendChild(p1);
    svg.appendChild(p2);
    return svg;
  }

  /**
   * Creates a checkmark SVG element (GitHub's check icon).
   */
  function createCheckIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute(
      "d",
      "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
    );
    svg.appendChild(p);
    return svg;
  }

  /**
   * Sets a button's contents to an SVG icon + text label, using safe DOM APIs.
   */
  function setButtonContent(btn, iconFactory, label) {
    btn.textContent = "";
    btn.appendChild(iconFactory());
    if (label) {
      btn.appendChild(document.createTextNode(" " + label));
    }
  }

  /**
   * Sets the Copy All button content including the badge.
   */
  function setCopyAllButtonContent(btn, count) {
    btn.textContent = "";
    btn.appendChild(createCopyIcon());
    btn.appendChild(
      document.createTextNode(" Copy All Copilot Comments ")
    );
    const badge = document.createElement("span");
    badge.className = "copilot-badge";
    badge.textContent = String(count);
    btn.appendChild(badge);
  }

  // Marker attribute to avoid re-processing the same comment element
  const PROCESSED_ATTR = "data-copilot-copy-processed";

  // ==========================================================================
  // Module 1: Copilot Comment Detection
  // ==========================================================================

  /**
   * Checks whether a given comment container element belongs to Copilot.
   * Works with both legacy (.js-*) and React-based GitHub DOM.
   */
  function isCopilotComment(container) {
    // Strategy 1: Look for author links pointing to a Copilot GitHub App
    const authorLinks = container.querySelectorAll(
      'a[href*="/apps/copilot"]'
    );
    if (authorLinks.length > 0) return true;

    // Strategy 2: Look for bot hovercard with copilot in the URL
    const botHovercards = container.querySelectorAll(
      '[data-hovercard-type="bot"]'
    );
    for (const el of botHovercards) {
      const href = el.getAttribute("href") || "";
      const hovercardUrl = el.getAttribute("data-hovercard-url") || "";
      if (href.includes("copilot") || hovercardUrl.includes("copilot")) {
        return true;
      }
    }

    // Strategy 3: Text-based fallback — look for "copilot" in author name area
    // Scope this narrowly to avoid matching comment body text
    const headerSelectors = [
      ".timeline-comment-header",
      '[data-testid="comment-header"]',
      ".comment-header",
    ];
    for (const sel of headerSelectors) {
      const header = container.querySelector(sel);
      if (header) {
        const authorEls = header.querySelectorAll(
          'a.author, a[data-testid="avatar-link"], .author'
        );
        for (const a of authorEls) {
          if (/copilot/i.test(a.textContent)) return true;
        }
      }
    }

    return false;
  }

  /**
   * Returns all Copilot comment container elements currently in the DOM,
   * deduplicated so that nested containers don't produce duplicates.
   * Excludes the top-level review summary comment.
   */
  function findAllCopilotComments() {
    // Strategy: find all comment *body* elements, walk up to the nearest
    // container, check if it's Copilot, deduplicate, and filter out summaries.
    //
    // We use only the specific comment-body selectors (not .markdown-body,
    // which appears in many non-comment contexts across GitHub).
    const bodyEls = document.querySelectorAll(
      ".js-comment-body, .comment-body"
    );

    const seen = new Set();
    const results = [];

    for (const body of bodyEls) {
      // Walk up to the nearest (innermost) comment container
      const container = body.closest(
        ".review-comment, .js-comment-container, .react-issue-comment, .TimelineItem"
      );
      if (!container) continue;

      // Deduplicate: skip if we've already seen this container element
      if (seen.has(container)) continue;
      seen.add(container);

      // Also skip if this container is nested inside one we already collected
      // (e.g. a .review-comment inside a .TimelineItem)
      let dominated = false;
      for (const existing of results) {
        if (existing.contains(container) || container.contains(existing)) {
          dominated = true;
          break;
        }
      }
      if (dominated) continue;

      // Skip non-Copilot comments
      if (!isCopilotComment(container)) continue;

      // Skip the summary/overview comment
      if (isSummaryComment(container)) continue;

      results.push(container);
    }

    return results;
  }

  /**
   * Detects whether a comment is Copilot's top-level review summary
   * (the overview comment with the file table, "Copilot reviewed N out of M",
   * custom instructions link, etc.). These are not actionable inline comments.
   */
  function isSummaryComment(container) {
    const body = container.querySelector(
      ".js-comment-body, .comment-body, .markdown-body"
    );
    if (!body) return false;

    const text = body.textContent || "";

    // The summary always contains this pattern
    if (/Copilot reviewed \d+ out of \d+ changed files?/i.test(text)) {
      return true;
    }

    // Also detect via the "Reviewed changes" or "Pull request overview" heading
    if (/Pull request overview/i.test(text) && /Reviewed changes/i.test(text)) {
      return true;
    }

    return false;
  }

  // ==========================================================================
  // Module 2: HTML-to-Markdown Converter
  // ==========================================================================

  /**
   * Lightweight HTML-to-Markdown converter targeting the subset of HTML that
   * GitHub renders inside comment bodies.
   */
  function htmlToMarkdown(element) {
    return convertNode(element)
      .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
      .replace(/^[ \t]+```/gm, "```") // remove leading whitespace before code fences
      .trim();
  }

  function convertNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();

    // --- Suggested changes block ---
    // Only intercept the suggestion diff container *itself*, not any parent
    // wrapper (otherwise surrounding explanation text gets swallowed).
    // The actual diff container has class "js-suggested-changes-blob".
    if (
      node.classList.contains("js-suggested-changes-blob") ||
      node.getAttribute("data-testid") === "suggested-changes-blob"
    ) {
      return convertSuggestedChange(node);
    }

    // Skip the "Suggested change" header bar, commit/batch buttons,
    // and template blocks — they're UI chrome, not content.
    if (
      node.classList.contains("js-suggested-changes-contents") ||
      node.classList.contains("suggested-change-form-container") ||
      node.tagName.toLowerCase() === "template"
    ) {
      return "";
    }

    // --- Standard tags ---
    switch (tag) {
      case "br":
        return "\n";

      case "p":
        return "\n\n" + convertChildren(node) + "\n\n";

      case "strong":
      case "b":
        return "**" + convertChildren(node) + "**";

      case "em":
      case "i":
        return "*" + convertChildren(node) + "*";

      case "del":
      case "s":
        return "~~" + convertChildren(node) + "~~";

      case "code": {
        // Inline code (not inside a <pre>)
        const parent = node.parentElement;
        if (parent && parent.tagName.toLowerCase() === "pre") {
          return convertChildren(node);
        }
        return "`" + node.textContent + "`";
      }

      case "pre": {
        const codeEl = node.querySelector("code");
        const text = codeEl ? codeEl.textContent : node.textContent;
        // Try to detect language from class (e.g., "highlight-source-js")
        let lang = "";
        const langClass = (codeEl || node).className.match(
          /(?:highlight-source-|language-)(\w+)/
        );
        if (langClass) lang = langClass[1];
        return "\n\n```" + lang + "\n" + text + "\n```\n\n";
      }

      case "a": {
        const href = node.getAttribute("href") || "";
        const text = convertChildren(node);
        if (!href || text === href) return text;
        // Make relative GitHub URLs absolute
        const fullHref = href.startsWith("/")
          ? "https://github.com" + href
          : href;
        return "[" + text + "](" + fullHref + ")";
      }

      case "img": {
        const alt = node.getAttribute("alt") || "";
        const src = node.getAttribute("src") || "";
        return "![" + alt + "](" + src + ")";
      }

      case "h1":
        return "\n\n# " + convertChildren(node) + "\n\n";
      case "h2":
        return "\n\n## " + convertChildren(node) + "\n\n";
      case "h3":
        return "\n\n### " + convertChildren(node) + "\n\n";
      case "h4":
        return "\n\n#### " + convertChildren(node) + "\n\n";
      case "h5":
        return "\n\n##### " + convertChildren(node) + "\n\n";
      case "h6":
        return "\n\n###### " + convertChildren(node) + "\n\n";

      case "blockquote":
        return (
          "\n\n" +
          convertChildren(node)
            .trim()
            .split("\n")
            .map((l) => "> " + l)
            .join("\n") +
          "\n\n"
        );

      case "ul":
        return "\n\n" + convertListItems(node, "ul") + "\n\n";

      case "ol":
        return "\n\n" + convertListItems(node, "ol") + "\n\n";

      case "li": {
        // Handled by convertListItems; fallback for orphan <li>
        return "- " + convertChildren(node) + "\n";
      }

      case "hr":
        return "\n\n---\n\n";

      case "table":
        return convertTable(node);

      case "div":
      case "span":
      case "section":
      case "article":
      case "details":
      case "summary":
      case "dd":
      case "dt":
      case "dl":
      case "td":
      case "th":
      case "tr":
      case "thead":
      case "tbody":
      case "tfoot":
        return convertChildren(node);

      // Skip elements that are not content
      case "script":
      case "style":
      case "template":
      case "task-lists":
        return "";

      default:
        return convertChildren(node);
    }
  }

  function convertChildren(node) {
    let result = "";
    for (const child of node.childNodes) {
      result += convertNode(child);
    }
    return result;
  }

  function convertListItems(listNode, listType) {
    const items = listNode.querySelectorAll(":scope > li");
    let result = "";
    let i = 1;
    for (const li of items) {
      // Check for task list checkboxes
      const checkbox = li.querySelector(
        'input[type="checkbox"]'
      );
      let prefix;
      if (listType === "ol") {
        prefix = i + ". ";
      } else if (checkbox) {
        prefix = checkbox.checked ? "- [x] " : "- [ ] ";
      } else {
        prefix = "- ";
      }
      result += prefix + convertChildren(li).trim() + "\n";
      i++;
    }
    return result.trimEnd();
  }

  function convertTable(tableNode) {
    const rows = tableNode.querySelectorAll("tr");
    if (rows.length === 0) return "";

    let md = "\n\n";
    let isHeader = true;

    for (const row of rows) {
      const cells = row.querySelectorAll("th, td");
      const cellTexts = Array.from(cells).map((c) =>
        convertChildren(c).trim().replace(/\|/g, "\\|")
      );
      md += "| " + cellTexts.join(" | ") + " |\n";
      if (isHeader) {
        md += "| " + cellTexts.map(() => "---").join(" | ") + " |\n";
        isHeader = false;
      }
    }
    return md + "\n";
  }

  /**
   * Converts a GitHub "suggested change" block back to markdown showing both
   * the original code and the suggested replacement, separated clearly.
   *
   * Output format:
   *   ```diff
   *   # Original
   *   - old line 1
   *   # Suggested
   *   + new line 1
   *   ```
   */
  function convertSuggestedChange(container) {
    // Find the suggestion blob — may be the container itself or a child
    const blob =
      container.classList.contains("js-suggested-changes-blob")
        ? container
        : container.querySelector(".js-suggested-changes-blob") ||
          container.querySelector('[data-testid="suggested-changes-blob"]');

    if (!blob) return convertChildren(container);

    const additionLines = [];
    const deletionLines = [];
    const seen = new Set();

    // Select only <tr> rows inside the diff table, then classify by
    // checking for addition/deletion classes on the row or its cells.
    const rows = blob.querySelectorAll("tr");

    for (const row of rows) {
      const codeCell = row.querySelector(".blob-code-inner");
      if (!codeCell) continue;

      // Deduplicate: skip if we already extracted this exact cell
      if (seen.has(codeCell)) continue;
      seen.add(codeCell);

      const text = codeCell.textContent || "";

      // Classify the row by checking the <tr> and its child <td> elements
      const isAddition =
        row.classList.contains("blob-code-addition") ||
        row.querySelector(".blob-code-addition") !== null ||
        row.getAttribute("data-code-marker") === "+";
      const isDeletion =
        row.classList.contains("blob-code-deletion") ||
        row.querySelector(".blob-code-deletion") !== null ||
        row.getAttribute("data-code-marker") === "-";

      if (isAddition) {
        let line = text;
        if (line.startsWith("+")) line = line.slice(1);
        additionLines.push(line);
      } else if (isDeletion) {
        let line = text;
        if (line.startsWith("-")) line = line.slice(1);
        deletionLines.push(line);
      }
    }

    if (additionLines.length > 0 || deletionLines.length > 0) {
      return formatSuggestionDiff(deletionLines, additionLines);
    }

    // Fallback: if we can't classify, return all code lines as a generic block
    const codeInners = blob.querySelectorAll(".blob-code-inner");
    if (codeInners.length > 0) {
      const all = Array.from(codeInners).map((el) => el.textContent);
      return "\n```\n" + all.join("\n") + "\n```\n";
    }

    return convertChildren(container);
  }

  /**
   * Formats original and suggested lines into a readable diff block.
   */
  function formatSuggestionDiff(originalLines, suggestedLines) {
    let diff = "```diff\n";
    if (originalLines.length > 0) {
      diff += originalLines.map((l) => "- " + l).join("\n") + "\n";
    }
    if (suggestedLines.length > 0) {
      diff += suggestedLines.map((l) => "+ " + l).join("\n") + "\n";
    }
    diff += "```";
    return diff;
  }

  // ==========================================================================
  // Module 3: Comment Content Extraction
  // ==========================================================================

  /**
   * Extracts the file path and line range context for a review comment.
   */
  function extractFileContext(commentContainer) {
    let filePath = null;
    let lineRange = null;

    // Collect all ancestor search roots — the comment itself plus
    // any thread wrapper that sits above it in the DOM.
    // Use parentElement for .closest() to avoid matching the container itself.
    const searchRoots = [commentContainer];
    const parent = commentContainer.parentElement;
    if (parent) {
      const threadAncestor = parent.closest(
        ".js-resolvable-timeline-thread-container, " +
        ".timeline-comment-group, " +
        ".js-comment-container, " +
        ".outdated-comment"
      );
      if (threadAncestor && threadAncestor !== commentContainer) {
        searchRoots.push(threadAncestor);
      }
    }
    // Also check the file container for inline diff comments
    const fileContainer = commentContainer.closest(".file, .js-file");
    if (fileContainer) {
      searchRoots.push(fileContainer);
    }

    for (const root of searchRoots) {
      if (filePath && lineRange) break;

      // --- File path ---
      // On the Conversation tab, the file path is in an <a> with class
      // Link--primary inside the <summary> of the thread container.
      // On the Files tab, it's in .file-header .file-info a[title].
      if (!filePath) {
        const pathLink = root.querySelector(
          'a.Link--primary[href*="#diff-"], ' +
          '.file-header .file-info a, ' +
          '.file-header a[title]'
        );
        if (pathLink) {
          filePath =
            pathLink.getAttribute("title") ||
            pathLink.textContent.trim();
        }
      }

      // --- Line range: Strategy 1 ---
      // GitHub renders line range as styled spans in the thread header:
      //   <span class="js-multi-line-preview-start">+220</span>
      //   to
      //   <span class="js-multi-line-preview-end">+230</span>
      if (!lineRange) {
        const startSpan = root.querySelector(".js-multi-line-preview-start");
        const endSpan = root.querySelector(".js-multi-line-preview-end");
        if (startSpan) {
          const startNum = parseInt(startSpan.textContent.replace(/[^0-9]/g, ""), 10);
          const endNum = endSpan
            ? parseInt(endSpan.textContent.replace(/[^0-9]/g, ""), 10)
            : NaN;
          if (!isNaN(startNum)) {
            lineRange =
              !isNaN(endNum) && endNum !== startNum
                ? `${startNum}-${endNum}`
                : `${startNum}`;
          }
        }
      }

      // --- Line range: Strategy 2 ---
      // Extract from a #diff- link href like #diff-<hash>R244 or R42-R50
      if (!lineRange) {
        const diffLinks = root.querySelectorAll('a[href*="#diff-"]');
        for (const link of diffLinks) {
          const href = link.getAttribute("href") || "";
          const hrefMatch = href.match(/[RL](\d+)(?:[-–][RL](\d+))?$/);
          if (hrefMatch) {
            const start = parseInt(hrefMatch[1], 10);
            const end = hrefMatch[2] ? parseInt(hrefMatch[2], 10) : null;
            lineRange =
              end && end !== start ? `${start}-${end}` : `${start}`;
            break;
          }
        }
      }

      // --- Line range: Strategy 3 ---
      // Fallback: extract from blob-num cells (Files Changed tab)
      if (!lineRange) {
        const lineNums = root.querySelectorAll(
          "td.blob-num[data-line-number]"
        );
        if (lineNums.length > 0) {
          const numbers = Array.from(lineNums)
            .map((el) => parseInt(el.getAttribute("data-line-number"), 10))
            .filter((n) => !isNaN(n));
          if (numbers.length > 0) {
            const min = Math.min(...numbers);
            const max = Math.max(...numbers);
            lineRange = min === max ? `${min}` : `${min}-${max}`;
          }
        }
      }
    }

    return { filePath, lineRange };
  }

  /**
   * Extracts the full content of a single Copilot comment as Markdown.
   */
  function extractCommentMarkdown(commentContainer) {
    // Find the comment body element
    const body = commentContainer.querySelector(
      ".js-comment-body, .comment-body, .edit-comment-hide .markdown-body, .markdown-body"
    );

    if (!body) return null;

    const { filePath, lineRange } = extractFileContext(commentContainer);
    let markdown = "";

    // Add file context header in file:line format
    if (filePath) {
      if (lineRange) {
        markdown += "**" + filePath + ":" + lineRange + "**";
      } else {
        markdown += "**" + filePath + "**";
      }
      markdown += "\n\n";
    }

    // Convert body HTML to markdown
    markdown += htmlToMarkdown(body);

    return markdown || null;
  }

  /**
   * Extracts all Copilot comments on the page and returns them as a single
   * Markdown string separated by horizontal rules.
   */
  function extractAllCommentsMarkdown() {
    const comments = findAllCopilotComments();
    const markdowns = [];

    for (const c of comments) {
      const md = extractCommentMarkdown(c);
      if (md) markdowns.push(md);
    }

    return markdowns.join("\n\n---\n\n");
  }

  // ==========================================================================
  // Module 4: Clipboard Operations
  // ==========================================================================

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback: textarea + execCommand
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch (e) {
        console.error("[Copilot Copy] Failed to copy to clipboard:", e);
        return false;
      }
    }
  }

  // ==========================================================================
  // Module 5: UI Injection
  // ==========================================================================

  /**
   * Creates a "Copy" button element.
   */
  function createCopyButton(label, onClick) {
    const btn = document.createElement("button");
    btn.className = "copilot-copy-btn";
    btn.type = "button";
    setButtonContent(btn, createCopyIcon, label);
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const success = await onClick();
      if (success) {
        showCopiedFeedback(btn, label);
      }
    });
    return btn;
  }

  /**
   * Shows brief "Copied!" visual feedback on a button.
   */
  let copyAllFeedbackActive = false;

  function showCopiedFeedback(btn, originalLabel) {
    const isAllBtn = btn.classList.contains("copilot-copy-all-btn");
    const copiedClass = isAllBtn
      ? "copilot-copy-all-btn--copied"
      : "copilot-copy-btn--copied";

    if (isAllBtn) copyAllFeedbackActive = true;

    setButtonContent(btn, createCheckIcon, "Copied!");
    btn.classList.add(copiedClass);

    setTimeout(() => {
      btn.classList.remove(copiedClass);
      if (isAllBtn) {
        copyAllFeedbackActive = false;
        updateCopyAllButton();
      } else {
        setButtonContent(btn, createCopyIcon, originalLabel);
      }
    }, 1500);
  }

  /**
   * Injects a "Copy" button into a single Copilot comment's header.
   */
  function injectCopyButton(commentContainer) {
    // Guard: skip if already processed OR if a button already exists inside
    if (commentContainer.getAttribute(PROCESSED_ATTR)) return;
    if (commentContainer.querySelector(".copilot-copy-btn")) return;
    commentContainer.setAttribute(PROCESSED_ATTR, "true");

    // Find the header actions area
    const headerActions = commentContainer.querySelector(
      [
        ".timeline-comment-actions",
        ".comment-header .timeline-comment-actions",
        '[data-testid="comment-header"]',
        ".timeline-comment-header .timeline-comment-actions",
        ".timeline-comment-header",
        ".comment-header",
      ].join(", ")
    );

    if (!headerActions) return;

    const btn = createCopyButton("Copy", async () => {
      const md = extractCommentMarkdown(commentContainer);
      if (!md) return false;
      return await copyToClipboard(md);
    });

    // Insert as the first child or append, depending on the container
    if (headerActions.classList.contains("timeline-comment-actions")) {
      headerActions.prepend(btn);
    } else {
      headerActions.appendChild(btn);
    }
  }

  /**
   * Creates/updates the floating "Copy All" button.
   */
  let copyAllButton = null;

  function updateCopyAllButton() {
    const comments = findAllCopilotComments();
    const count = comments.length;

    if (count === 0) {
      if (copyAllButton) {
        copyAllButton.classList.add("copilot-copy-all-btn--hidden");
      }
      return;
    }

    if (!copyAllButton) {
      copyAllButton = document.createElement("button");
      copyAllButton.className = "copilot-copy-all-btn";
      copyAllButton.type = "button";
      copyAllButton.addEventListener("click", async (e) => {
        e.preventDefault();
        const md = extractAllCommentsMarkdown();
        if (!md) return;
        const success = await copyToClipboard(md);
        if (success) {
          showCopiedFeedback(copyAllButton, "");
        }
      });
      document.body.appendChild(copyAllButton);
    }

    // Don't overwrite the "Copied!" feedback while it's showing
    if (copyAllFeedbackActive) return;

    setCopyAllButtonContent(copyAllButton, count);
    copyAllButton.classList.remove("copilot-copy-all-btn--hidden");
  }

  // ==========================================================================
  // Module 6: Scanning & Observation
  // ==========================================================================

  /**
   * Scans the current page for Copilot comments and injects UI.
   */
  function scanAndInject() {
    const comments = findAllCopilotComments();
    for (const c of comments) {
      injectCopyButton(c);
    }
    updateCopyAllButton();
  }

  /**
   * Sets up a MutationObserver to detect dynamically loaded comments.
   */
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        // Debounce to avoid excessive re-scanning
        clearTimeout(setupObserver._timer);
        setupObserver._timer = setTimeout(scanAndInject, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return observer;
  }

  /**
   * Handles GitHub's SPA navigation (Turbo/pjax).
   * Re-scans the page when the URL changes.
   */
  function setupSPAListener() {
    // Turbo navigation events (modern GitHub)
    document.addEventListener("turbo:load", () => {
      setTimeout(scanAndInject, 500);
    });

    // Pjax events (legacy GitHub)
    document.addEventListener("pjax:end", () => {
      setTimeout(scanAndInject, 500);
    });

    // Fallback: watch for URL changes via popstate
    let lastUrl = location.href;
    const urlCheck = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Reset processed markers since DOM may have been replaced
        document.querySelectorAll("[" + PROCESSED_ATTR + "]").forEach((el) => {
          el.removeAttribute(PROCESSED_ATTR);
        });
        setTimeout(scanAndInject, 500);
      }
    };
    window.addEventListener("popstate", urlCheck);
    // Also poll periodically as a safety net for SPA transitions
    setInterval(urlCheck, 2000);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  function init() {
    // Only run on PR pages
    if (!location.pathname.match(/\/pull\/\d+/)) return;

    scanAndInject();
    setupObserver();
    setupSPAListener();

    console.log("[Copilot PR Comment Copier] Initialized");
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
