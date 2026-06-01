export type PlanChoiceState = {
  messageId: string
  question: string
  options: string[]
}

export const parsePlanModeChoice = (text: string): { question: string; options: string[] } | null => {
  const lines = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r/g, '')
    .split('\n')
  const questionLines: string[] = []
  const options: string[] = []
  let isCollectingOptions = false
  let currentOptionLine = ''

  const optionMatch = (value: string): string | null => {
    const trimmed = value.trim()
    const match = trimmed.match(/^(?:[-*+•]?\s*)?(?:\(?([A-Za-z]|\d+)\)?[.)])\s+(.+)$/)
    if (!match) return null
    return match[2]?.trim()
  }

  for (const line of lines) {
    const parsedOption = optionMatch(line)
    if (parsedOption) {
      isCollectingOptions = true
      currentOptionLine = parsedOption
      options.push(currentOptionLine)
      continue
    }

    if (!isCollectingOptions) {
      if (line.trim()) {
        questionLines.push(line.trim())
      }
      continue
    }

    if (currentOptionLine && line.trim()) {
      currentOptionLine = `${currentOptionLine} ${line.trim()}`
      options[options.length - 1] = currentOptionLine
    }
  }

  if (options.length < 2) {
    return null
  }

  const uniqueOptions = [
    ...new Set(options.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))
  ]

  if (uniqueOptions.length < 2) {
    return null
  }

  const question = questionLines.filter(Boolean).join(' ').trim()
  const likelyChoicePrompt =
    /(\bchoose\b|\bselect\b|\bpick\b|\bwhich\b|\boption\b|\boptions?\b|\bdecide\b)/i.test(question)
  const looksLikeQuestion = /\?\s*$/.test(question)
  if (!question || (!likelyChoicePrompt && !looksLikeQuestion)) {
    return null
  }

  return {
    question: question || 'Please choose one option to continue.',
    options: uniqueOptions
  }
}
