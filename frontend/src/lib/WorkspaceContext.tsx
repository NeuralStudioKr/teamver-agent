'use client'
import { createContext, useContext } from 'react'
import type { Socket } from 'socket.io-client'

export interface WorkspaceContextValue {
  activeChannel: string
  setActiveChannel: (id: string) => void
  socket: Socket | null
  currentUser: any
  workspace: any
  members: any[]
  channels: any[]
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  activeChannel: '',
  setActiveChannel: () => {},
  socket: null,
  currentUser: null,
  workspace: null,
  members: [],
  channels: [],
})

export const useWorkspace = () => useContext(WorkspaceContext)
