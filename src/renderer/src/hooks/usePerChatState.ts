import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export type PerChatStateAction<T> = T | ((previous: T) => T)

export const applyStateAction = <T,>(value: PerChatStateAction<T>, previous: T): T =>
  typeof value === 'function' ? (value as (previous: T) => T)(previous) : value

export const usePerChatState = <T,>(initial: T): readonly [
  Record<string, T>,
  (chatId: string | null | undefined, value: PerChatStateAction<T>) => void,
  Dispatch<SetStateAction<Record<string, T>>>
] => {
  const [valuesByChatId, setValuesByChatId] = useState<Record<string, T>>({})

  const setForChat = useCallback((chatId: string | null | undefined, value: PerChatStateAction<T>) => {
    if (!chatId) return
    setValuesByChatId((previousValues) => {
      const previous = previousValues[chatId] ?? initial
      const nextValue = applyStateAction(value, previous)

      if (Object.is(nextValue, initial)) {
        if (!(chatId in previousValues)) return previousValues
        const nextValues = { ...previousValues }
        delete nextValues[chatId]
        return nextValues
      }

      if (Object.is(previousValues[chatId], nextValue)) {
        return previousValues
      }

      return { ...previousValues, [chatId]: nextValue }
    })
  }, [initial])

  return [valuesByChatId, setForChat, setValuesByChatId] as const
}
