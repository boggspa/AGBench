import { describe, expect, it } from 'vitest'
import { classifyOllamaPromptIntent, extractOllamaCurrentRequestText } from './OllamaPromptIntent'

describe('classifyOllamaPromptIntent', () => {
  it('treats greetings and small talk as conversational', () => {
    expect(classifyOllamaPromptIntent('Hi OSS how are you?')).toBe('conversational')
    expect(classifyOllamaPromptIntent('hello there!')).toBe('conversational')
    expect(classifyOllamaPromptIntent('good morning')).toBe('conversational')
    expect(classifyOllamaPromptIntent('what can you do?')).toBe('conversational')
    expect(classifyOllamaPromptIntent('who are you?')).toBe('conversational')
  })

  it('treats general non-repo questions as conversational on a fresh chat', () => {
    expect(classifyOllamaPromptIntent("what's the weather in Tokyo today?")).toBe('conversational')
    expect(classifyOllamaPromptIntent('plan a three day trip to Rome')).toBe('conversational')
  })

  it('classifies coding-task language as workspace', () => {
    expect(classifyOllamaPromptIntent('fix the failing login test')).toBe('workspace')
    expect(classifyOllamaPromptIntent('hi! can you fix the login bug?')).toBe('workspace')
    expect(classifyOllamaPromptIntent('summarize this repo')).toBe('workspace')
    expect(classifyOllamaPromptIntent('what does this project do?')).toBe('workspace')
    expect(classifyOllamaPromptIntent('rename the helper in utils')).toBe('workspace')
  })

  it('classifies path-like and code-like tokens as workspace', () => {
    expect(classifyOllamaPromptIntent('look at src/main/index.ts please')).toBe('workspace')
    expect(classifyOllamaPromptIntent('what does `composeRunPrompt` return?')).toBe('workspace')
    expect(classifyOllamaPromptIntent('open OllamaProvider.ts')).toBe('workspace')
  })

  it('classifies long multi-line briefs as workspace even without keywords', () => {
    const brief = [
      'Here is what I need from you today.',
      'First thing.',
      'Second thing.',
      'Third thing.',
      'Fourth thing.'
    ].join('\n')
    expect(classifyOllamaPromptIntent(brief)).toBe('workspace')
    expect(classifyOllamaPromptIntent('x'.repeat(300))).toBe('workspace')
  })

  it('defaults empty prompts to workspace', () => {
    expect(classifyOllamaPromptIntent('')).toBe('workspace')
    expect(classifyOllamaPromptIntent('   ')).toBe('workspace')
  })

  it('keeps ambiguous follow-ups in workspace once tool work has happened', () => {
    expect(classifyOllamaPromptIntent('now make it faster', { ongoingWork: true })).toBe(
      'workspace'
    )
    expect(classifyOllamaPromptIntent('continue', { ongoingWork: true })).toBe('workspace')
    expect(classifyOllamaPromptIntent('do the second one as well', { ongoingWork: true })).toBe(
      'workspace'
    )
  })

  it('still recognises clear thanks/greetings during ongoing work', () => {
    expect(classifyOllamaPromptIntent('thanks, that looks great!', { ongoingWork: true })).toBe(
      'conversational'
    )
    expect(classifyOllamaPromptIntent('hey, how are you holding up?', { ongoingWork: true })).toBe(
      'conversational'
    )
  })
})

describe('extractOllamaCurrentRequestText', () => {
  it('returns the text after the last Current user request marker', () => {
    const composed = [
      'Conversation context (last 2 turn(s)):',
      'User: fix the bug in src/foo.ts',
      'Gemini: done',
      'Current user request:',
      'thanks, that looks great!'
    ].join('\n')
    expect(extractOllamaCurrentRequestText(composed)).toBe('thanks, that looks great!')
  })

  it('returns the whole prompt when no marker exists', () => {
    expect(extractOllamaCurrentRequestText('  Hi OSS how are you?  ')).toBe('Hi OSS how are you?')
  })

  it('uses the last marker when history itself contains one', () => {
    const composed = [
      'Conversation context:',
      'User: Current user request:',
      'old text',
      'Current user request:',
      'hello again'
    ].join('\n')
    expect(extractOllamaCurrentRequestText(composed)).toBe('hello again')
  })
})
