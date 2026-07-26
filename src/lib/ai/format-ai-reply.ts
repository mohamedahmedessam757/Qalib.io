/**
 * Strip markdown/HTML/model-thought noise from assistant replies.
 */
export function formatAiReply(text: string): string {
  if (!text) return text;
  let out = text;

  // Model "thought" / channel blocks (Gemma & similar)
  out = out.replace(/<\|?(?:thought|channel|tool_call)[^|>]*\|?>[\s\S]*?(?:<\/\|?[^>]+>\|<\|?\/?\w+\|>|$)/gi, "");
  out = out.replace(/<\|[^|>]+\|>/g, "");
  out = out.replace(/<\/?thought\b[^>]*>/gi, "");
  out = out.replace(/channel\s*>/gi, "");

  // fenced code → inner text
  out = out.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1");
  // **bold** / __bold__
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  // *italic* / _italic_
  out = out.replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g, "$1$2");
  // stray leftover ** or *
  out = out.replace(/\*{1,2}/g, "");
  // bogus tags
  out = out.replace(/<\/?h\d?>/gi, "");
  out = out.replace(/<\/?(?:b|i|strong|em|u|p|br|span|div)[^>]*>/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
