import { createContext } from 'react'
import type { ChatRecord } from '../../../main/store/types'

/**
 * Context that provides the current chat to nested markdown renderers so
 * `<AgentMention>` can look up colored identities by agent id without prop
 * drilling through ReactMarkdown.
 */
export const AgentIdentityContext = createContext<ChatRecord | undefined>(undefined)
