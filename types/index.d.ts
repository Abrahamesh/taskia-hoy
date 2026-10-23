export type TaskiaTask = {
  ref: string
  name: string
  workspace: string
  path: string
  status: string
  pct: number
  advice: string
  canDo: boolean
}

export type TaskiaLoad = 'idle' | 'loading' | 'ready' | 'error'

declare module 'claude-code' {
  interface PluginState {
    'taskia-hoy': {
      tasks: TaskiaTask[]
      load: TaskiaLoad
      error: string
      updatedAt: string
      brief: string
      flipped: string[]
    }
  }
}
