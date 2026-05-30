import { wrapOpaqueMarkdownBlock } from '../../../main/MarkdownFenceSerializer'

export function formatOpaqueMarkdownPromptSection(label: string, content: string): string {
  return `${label}:\n${wrapOpaqueMarkdownBlock(content, 'markdown')}`
}
