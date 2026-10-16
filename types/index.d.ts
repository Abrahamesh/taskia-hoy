export type TaskiaTask = {
  ref: string
  name: string
  workspace: string
  due: string
  status: string
  group: string
  summary: string
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
      open: string[]
    }
  }
}
